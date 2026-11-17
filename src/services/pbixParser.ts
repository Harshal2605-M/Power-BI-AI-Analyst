import JSZip from 'jszip';

export interface PbixColumn {
  name: string;
  dataType: string;
  isHidden?: boolean;
}

export interface PbixMeasure {
  name: string;
  expression: string;
  tableName?: string;
  description?: string;
  formatString?: string;
}

export interface PbixTable {
  name: string;
  columns: PbixColumn[];
  measures: PbixMeasure[];
  isHidden?: boolean;
  sourceType?: string;
}

export interface PbixRelationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  crossFilteringBehavior?: string;
  isActive?: boolean;
}

export interface PbixVisual {
  id: string | number;
  type: string;
  title?: string;
  fields: string[];
}

export interface PbixPage {
  name: string;
  displayName: string;
  visuals: PbixVisual[];
}

export interface PbixConnection {
  name: string;
  connectionString?: string;
  connectionType?: string;
}

export interface PbixParsedData {
  fileName: string;
  fileSizeBytes: number;
  version?: string;
  tables: PbixTable[];
  measures: PbixMeasure[];
  relationships: PbixRelationship[];
  pages: PbixPage[];
  connections: PbixConnection[];
  rawSchemaFound: boolean;
  hasVisuals: boolean;
  warnings: string[];
}

/**
 * Robust text decoder supporting UTF-8 and UTF-16LE (common in Power BI Layout & DataModelSchema)
 */
function decodeBuffer(uint8Array: Uint8Array): string {
  // UTF-16LE BOM: 0xFF, 0xFE
  if (uint8Array.length >= 2 && uint8Array[0] === 0xFF && uint8Array[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(uint8Array);
  }
  // Check if every second byte is 0 (UTF-16LE without BOM)
  if (uint8Array.length > 4 && uint8Array[1] === 0 && uint8Array[3] === 0) {
    try {
      return new TextDecoder('utf-16le').decode(uint8Array);
    } catch {
      // Fallback to utf-8
    }
  }
  return new TextDecoder('utf-8').decode(uint8Array);
}

/**
 * Extracts and parses all metadata, schema, measures, and visual pages from a .pbix / .pbit file
 */
export async function parsePbixFile(file: File | ArrayBuffer, fileName: string = 'model.pbix'): Promise<PbixParsedData> {
  const zip = new JSZip();
  const fileSizeBytes = file instanceof File ? file.size : file.byteLength;
  const content = await zip.loadAsync(file);

  const result: PbixParsedData = {
    fileName,
    fileSizeBytes,
    tables: [],
    measures: [],
    relationships: [],
    pages: [],
    connections: [],
    rawSchemaFound: false,
    hasVisuals: false,
    warnings: []
  };

  // 1. Extract Power BI Version
  const versionFile = content.file('Version');
  if (versionFile) {
    try {
      const vText = await versionFile.async('text');
      result.version = vText.trim();
    } catch {
      // ignore
    }
  }

  // 2. Extract DataModelSchema (TMDL / Enhanced Model Metadata JSON)
  const schemaFile = content.file('DataModelSchema');
  if (schemaFile) {
    try {
      const rawBytes = await schemaFile.async('uint8array');
      const jsonText = decodeBuffer(rawBytes);
      const schemaJson = JSON.parse(jsonText);

      result.rawSchemaFound = true;
      const model = schemaJson.model || schemaJson;

      // Extract tables and measures
      if (Array.isArray(model.tables)) {
        for (const tbl of model.tables) {
          // Skip internal date template tables if desired, but keep standard tables
          const isDateTable = tbl.name.startsWith('LocalDateTable_') || tbl.name.startsWith('DateTableTemplate_');
          
          const columns: PbixColumn[] = [];
          if (Array.isArray(tbl.columns)) {
            for (const col of tbl.columns) {
              columns.push({
                name: col.name,
                dataType: col.dataType || 'string',
                isHidden: !!col.isHidden
              });
            }
          }

          const measures: PbixMeasure[] = [];
          if (Array.isArray(tbl.measures)) {
            for (const m of tbl.measures) {
              const measureObj: PbixMeasure = {
                name: m.name,
                expression: Array.isArray(m.expression) ? m.expression.join('\n') : (m.expression || ''),
                tableName: tbl.name,
                description: m.description || '',
                formatString: m.formatString || ''
              };
              measures.push(measureObj);
              result.measures.push(measureObj);
            }
          }

          result.tables.push({
            name: tbl.name,
            columns,
            measures,
            isHidden: isDateTable || !!tbl.isHidden
          });
        }
      }

      // Extract relationships
      if (Array.isArray(model.relationships)) {
        for (const rel of model.relationships) {
          result.relationships.push({
            fromTable: rel.fromTable,
            fromColumn: rel.fromColumn,
            toTable: rel.toTable,
            toColumn: rel.toColumn,
            crossFilteringBehavior: rel.crossFilteringBehavior || 'oneWay',
            isActive: rel.isActive !== false
          });
        }
      }
    } catch (err: any) {
      result.warnings.push(`DataModelSchema found but parsing failed: ${err.message}`);
    }
  }

  // 3. Extract Connections
  const connectionsFile = content.file('Connections');
  if (connectionsFile) {
    try {
      const connText = await connectionsFile.async('text');
      const connJson = JSON.parse(connText);
      const list = Array.isArray(connJson.Connections) ? connJson.Connections : (Array.isArray(connJson) ? connJson : []);
      result.connections = list.map((c: any) => ({
        name: c.Name || c.name || 'Data Connection',
        connectionString: c.ConnectionString || c.connectionString || '',
        connectionType: c.ConnectionType || c.connectionType || ''
      }));
    } catch {
      // ignore
    }
  }

  // 4. Extract Report/Layout (Pages & Visuals)
  const layoutFile = content.file('Report/Layout');
  if (layoutFile) {
    try {
      const layoutBytes = await layoutFile.async('uint8array');
      const layoutText = decodeBuffer(layoutBytes);
      const layoutJson = JSON.parse(layoutText);

      result.hasVisuals = true;

      const sections = Array.isArray(layoutJson.sections) ? layoutJson.sections : [];
      for (const section of sections) {
        const page: PbixPage = {
          name: section.name,
          displayName: section.displayName || section.name,
          visuals: []
        };

        const containers = Array.isArray(section.visualContainers) ? section.visualContainers : [];
        for (const container of containers) {
          if (!container.config) continue;
          try {
            const config = JSON.parse(container.config);
            const singleVisual = config.singleVisual || {};
            const visualType = singleVisual.visualType || 'unknown';

            // Extract visual title
            let title = '';
            if (singleVisual.vcObjects && singleVisual.vcObjects.title && singleVisual.vcObjects.title[0]?.properties?.text?.expr?.Literal?.Value) {
              title = singleVisual.vcObjects.title[0].properties.text.expr.Literal.Value.replace(/^'|'$/g, '');
            }

            // Extract referenced fields
            const fields: string[] = [];
            if (singleVisual.projections) {
              for (const [, projItems] of Object.entries(singleVisual.projections)) {
                if (Array.isArray(projItems)) {
                  for (const item of projItems as any[]) {
                    if (item && item.queryRef) {
                      fields.push(item.queryRef);
                    }
                  }
                }
              }
            }

            // If prototypeQuery exists, extract referenced columns/measures
            if (singleVisual.prototypeQuery && Array.isArray(singleVisual.prototypeQuery.Select)) {
              for (const sel of singleVisual.prototypeQuery.Select) {
                if (sel.Name && !fields.includes(sel.Name)) {
                  fields.push(sel.Name);
                }
              }
            }

            page.visuals.push({
              id: container.id || Math.random().toString(),
              type: visualType,
              title: title || `${visualType} Visual`,
              fields
            });
          } catch {
            // Container config wasn't valid JSON, skip
          }
        }

        result.pages.push(page);
      }

      // If DataModelSchema was NOT present (e.g. legacy model), reconstruct tables & measures from Report/Layout!
      if (!result.rawSchemaFound && result.pages.length > 0) {
        const reconstructedTables = new Map<string, Set<string>>();
        for (const p of result.pages) {
          for (const v of p.visuals) {
            for (const f of v.fields) {
              // field format typically: "TableName.ColumnName" or "Sum(TableName.ColumnName)"
              const match = f.match(/([a-zA-Z0-9_\s]+)\.([a-zA-Z0-9_\s]+)/);
              if (match) {
                const tbl = match[1].replace(/^(Sum|Avg|Count|Min|Max)\(/, '');
                const col = match[2].replace(/\)$/, '');
                if (!reconstructedTables.has(tbl)) {
                  reconstructedTables.set(tbl, new Set());
                }
                reconstructedTables.get(tbl)!.add(col);
              }
            }
          }
        }

        for (const [tName, colSet] of reconstructedTables.entries()) {
          result.tables.push({
            name: tName,
            columns: Array.from(colSet).map(c => ({ name: c, dataType: 'string' })),
            measures: []
          });
        }
      }
    } catch (err: any) {
      result.warnings.push(`Report/Layout parsing error: ${err.message}`);
    }
  }

  // Filter out internal system tables from main summary
  return result;
}
