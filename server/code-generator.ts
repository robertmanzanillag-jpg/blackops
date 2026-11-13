import { isCodeAgentPathAllowed, readFile, writeFile, listFiles, getProjectStructure, getTableSchema, createTable, addColumnToTable } from "./code-agent";
import { getGeminiClient } from "./gemini-client";
import * as fs from 'fs';
import * as path from 'path';

interface CodeGenerationResult {
  success: boolean;
  files?: { path: string; content: string; action: 'create' | 'modify' }[];
  rejectedFiles?: { path: string; reason: string }[];
  tables?: { name: string; action: 'create' | 'modify'; columns?: any[] }[];
  explanation?: string;
  error?: string;
}

interface GenerationRequest {
  prompt: string;
  context?: string;
  preview?: boolean;
}

// Get replit.md content for project context
async function getProjectContext(): Promise<string> {
  try {
    const replitMd = fs.readFileSync(path.join(process.cwd(), 'replit.md'), 'utf-8');
    return replitMd;
  } catch {
    return 'No hay archivo replit.md disponible';
  }
}

// Get relevant file contents based on the request
async function getRelevantFiles(keywords: string[]): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  
  // Always include key files
  const keyFiles = ['shared/schema.ts', 'server/storage.ts'];
  
  for (const file of keyFiles) {
    const result = await readFile(file);
    if (result.success && result.content) {
      files.set(file, result.content);
    }
  }
  
  // Search for files matching keywords
  for (const dir of ['client/src', 'server']) {
    const listResult = await listFiles(dir);
    if (listResult.success && listResult.files) {
      for (const file of listResult.files) {
        const lowerFile = file.toLowerCase();
        if (keywords.some(kw => lowerFile.includes(kw.toLowerCase()))) {
          const result = await readFile(file);
          if (result.success && result.content) {
            files.set(file, result.content);
          }
        }
      }
    }
  }
  
  return files;
}

// Extract keywords from Spanish/English prompt
function extractKeywords(prompt: string): string[] {
  const words = prompt.toLowerCase().split(/\s+/);
  const stopWords = ['un', 'una', 'el', 'la', 'los', 'las', 'de', 'del', 'que', 'y', 'a', 'en', 'para', 'con', 'por', 'como', 'quiero', 'necesito', 'crear', 'agregar', 'añadir', 'nuevo', 'nueva', 'the', 'a', 'an', 'of', 'to', 'in', 'for', 'with', 'create', 'add', 'new'];
  return words.filter(w => w.length > 2 && !stopWords.includes(w));
}

// Robust JSON parser with sanitization
function sanitizeAndParseJSON(jsonStr: string): any {
  // Remove control characters except newlines and tabs
  let sanitized = jsonStr.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  
  // Try direct parse first
  try {
    return JSON.parse(sanitized);
  } catch (e) {
    // Continue with repair attempts
  }
  
  // Try to find and extract JSON object
  const startIdx = sanitized.indexOf('{');
  const endIdx = sanitized.lastIndexOf('}');
  if (startIdx !== -1 && endIdx > startIdx) {
    sanitized = sanitized.slice(startIdx, endIdx + 1);
  }
  
  // Escape unescaped newlines in string values
  sanitized = sanitized.replace(/"([^"]*)\n([^"]*)"/g, (match, before, after) => {
    return `"${before}\\n${after}"`;
  });
  
  // Try again
  try {
    return JSON.parse(sanitized);
  } catch (e) {
    // Continue with more aggressive repair
  }
  
  // Try to repair truncated JSON by closing brackets
  let repaired = sanitized;
  const openBraces = (repaired.match(/\{/g) || []).length;
  const closeBraces = (repaired.match(/\}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;
  
  // If we have unclosed strings, try to close them
  const lastQuote = repaired.lastIndexOf('"');
  const afterLastQuote = repaired.slice(lastQuote + 1);
  if (!afterLastQuote.includes('"') && afterLastQuote.match(/[a-zA-Z0-9]/)) {
    // Truncated in middle of string, close it
    repaired = repaired.slice(0, lastQuote + 1) + '"';
  }
  
  // Add missing brackets
  for (let i = 0; i < openBrackets - closeBrackets; i++) {
    repaired += ']';
  }
  for (let i = 0; i < openBraces - closeBraces; i++) {
    repaired += '}';
  }
  
  try {
    return JSON.parse(repaired);
  } catch (e) {
    // Final fallback: extract what we can
    return null;
  }
}

type GeneratedFilePlan = { path: string; content: string; action: 'create' | 'modify' };

export function validateGeneratedFilePlan(files: unknown): {
  files: GeneratedFilePlan[];
  rejectedFiles: { path: string; reason: string }[];
} {
  if (!Array.isArray(files)) return { files: [], rejectedFiles: [] };

  const accepted: GeneratedFilePlan[] = [];
  const rejectedFiles: { path: string; reason: string }[] = [];

  for (const file of files) {
    if (!file || typeof file !== "object") {
      rejectedFiles.push({ path: "unknown", reason: "file item is not an object" });
      continue;
    }
    const item = file as Record<string, unknown>;
    const filePath = typeof item.path === "string" ? item.path : "";
    const content = typeof item.content === "string" ? item.content : null;
    const action = item.action === "modify" ? "modify" : item.action === "create" ? "create" : null;

    if (!filePath) {
      rejectedFiles.push({ path: "unknown", reason: "path is required" });
      continue;
    }
    if (!isCodeAgentPathAllowed(filePath)) {
      rejectedFiles.push({ path: filePath, reason: "path is outside the Code Agent allowlist" });
      continue;
    }
    if (content === null) {
      rejectedFiles.push({ path: filePath, reason: "content must be a string" });
      continue;
    }
    if (!action) {
      rejectedFiles.push({ path: filePath, reason: "action must be create or modify" });
      continue;
    }

    accepted.push({ path: filePath, content, action });
  }

  return { files: accepted, rejectedFiles };
}

const SYSTEM_PROMPT = `Eres un agente de código para BlackOps Reminder (TypeScript/React).

RESPONDE SOLO JSON VÁLIDO, sin texto antes o después.
IMPORTANTE: Mantén el código CORTO y SIMPLE. Máximo 100 líneas por archivo.

Formato EXACTO:
{"explanation":"descripción corta","files":[{"path":"ruta.ts","action":"create","content":"código"}],"tables":[]}

REGLAS:
- TypeScript, Tailwind CSS, shadcn/ui
- Archivos en client/src/ o server/
- Código mínimo funcional

`;

export async function generateCode(request: GenerationRequest): Promise<CodeGenerationResult> {
  try {
    // Get project context
    const projectContext = await getProjectContext();
    const schemaResult = await getTableSchema();
    const keywords = extractKeywords(request.prompt);
    const relevantFiles = await getRelevantFiles(keywords);
    
    // Build context
    let fullContext = SYSTEM_PROMPT + '\n\n' + projectContext + '\n\n';
    
    if (schemaResult.success && schemaResult.tables) {
      fullContext += '## Esquema de base de datos actual:\n```\n';
      const tableGroups: Record<string, string[]> = {};
      for (const col of schemaResult.tables) {
        if (!tableGroups[col.table_name]) tableGroups[col.table_name] = [];
        tableGroups[col.table_name].push(`  ${col.column_name}: ${col.data_type}`);
      }
      for (const [table, cols] of Object.entries(tableGroups)) {
        fullContext += `${table}:\n${cols.join('\n')}\n\n`;
      }
      fullContext += '```\n\n';
    }
    
    if (relevantFiles.size > 0) {
      fullContext += '## Archivos relevantes:\n';
      relevantFiles.forEach((content, filePath) => {
        // Truncate large files
        const truncated = content.length > 3000 ? content.slice(0, 3000) + '\n... (truncado)' : content;
        fullContext += `\n### ${filePath}:\n\`\`\`typescript\n${truncated}\n\`\`\`\n`;
      });
    }
    
    if (request.context) {
      fullContext += '\n## Contexto adicional:\n' + request.context + '\n';
    }
    
    // Generate code
    const geminiClient = await getGeminiClient();
    const response = await geminiClient.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: fullContext + '\n\n## SOLICITUD:\n' + request.prompt + '\n\nResponde SOLO con JSON válido.' }] }
      ],
      config: {
        temperature: 0.2,
        maxOutputTokens: 8192,
      }
    });
    
    const responseText = response.text || '';
    
    // Extract JSON from response using robust parser
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }
    
    // Use robust JSON parser
    let parsed = sanitizeAndParseJSON(jsonStr);
    
    if (!parsed) {
      // Fallback: try to extract basic info with regex
      console.log('JSON parse failed, extracting with regex...');
      const explanationMatch = jsonStr.match(/"explanation"\s*:\s*"([^"]+)"/);
      const filesMatch = jsonStr.match(/"path"\s*:\s*"([^"]+)"/g);
      
      const files = filesMatch ? filesMatch.map(m => {
        const pathMatch = m.match(/"path"\s*:\s*"([^"]+)"/);
        return {
          path: pathMatch ? pathMatch[1] : 'unknown',
          content: '// Contenido detectado - regenera para ver código completo',
          action: 'create' as const
        };
      }) : [];
      
      parsed = {
        explanation: explanationMatch 
          ? explanationMatch[1] 
          : 'El modelo generó código pero hubo un problema al procesarlo. Los archivos listados se crearán al aplicar.',
        files: files,
        tables: []
      };
    }
    
    const generatedFilePlan = validateGeneratedFilePlan(parsed.files || []);
    if (generatedFilePlan.rejectedFiles.length > 0) {
      return {
        success: false,
        files: generatedFilePlan.files,
        rejectedFiles: generatedFilePlan.rejectedFiles,
        tables: parsed.tables || [],
        explanation: parsed.explanation || 'Plan rechazado por seguridad',
        error: `El plan generado incluye archivos no permitidos: ${generatedFilePlan.rejectedFiles.map((file) => file.path).join(", ")}`,
      };
    }

    // If preview mode, just return the plan
    if (request.preview) {
      return {
        success: true,
        files: generatedFilePlan.files,
        rejectedFiles: [],
        tables: parsed.tables || [],
        explanation: parsed.explanation || 'Sin explicación'
      };
    }
    
    // Apply changes
    const appliedFiles: { path: string; content: string; action: 'create' | 'modify' }[] = [];
    const appliedTables: { name: string; action: 'create' | 'modify'; columns?: any[] }[] = [];
    
    // Apply file changes
    if (generatedFilePlan.files) {
      for (const file of generatedFilePlan.files) {
        const result = await writeFile(file.path, file.content, `Generado: ${request.prompt.slice(0, 50)}...`);
        if (result.success) {
          appliedFiles.push(file);
        }
      }
    }
    
    // Apply table changes
    if (parsed.tables) {
      for (const table of parsed.tables) {
        if (table.action === 'create') {
          const result = await createTable({
            name: table.name,
            columns: table.columns || []
          });
          if (result.success) {
            appliedTables.push(table);
          }
        } else if (table.action === 'modify' && table.columns) {
          for (const col of table.columns) {
            await addColumnToTable(table.name, col);
          }
          appliedTables.push(table);
        }
      }
    }
    
    return {
      success: true,
      files: appliedFiles,
      tables: appliedTables,
      explanation: parsed.explanation || 'Cambios aplicados'
    };
  } catch (error) {
    console.error('Code generation error:', error);
    return {
      success: false,
      error: `Error generando código: ${error}`
    };
  }
}

// Module templates for common patterns
export const MODULE_TEMPLATES = {
  crud: {
    name: 'CRUD básico',
    description: 'Crea una entidad con lista, crear, editar, eliminar',
    prompt: (entityName: string) => `Crea un módulo CRUD completo para "${entityName}" con:
1. Tabla en la base de datos con id, nombre y campos básicos
2. Schema Drizzle en shared/schema.ts
3. Métodos de storage (getAll, create, update, delete)
4. Endpoints REST (GET /api/${entityName}s, POST, PATCH /:id, DELETE /:id)
5. Página React en client/src/pages/${entityName}.tsx con lista y formulario`
  },
  
  tracker: {
    name: 'Tracker/Logger',
    description: 'Sistema para registrar y visualizar datos en el tiempo',
    prompt: (entityName: string) => `Crea un tracker para "${entityName}" con:
1. Tabla con id, valor, fecha, notas
2. Endpoints para agregar y listar registros
3. Página con gráfico de línea mostrando valores en el tiempo
4. Formulario simple para agregar nuevos registros`
  },
  
  form: {
    name: 'Formulario avanzado',
    description: 'Formulario con validación y campos dinámicos',
    prompt: (formName: string, fields: string) => `Crea un formulario llamado "${formName}" con estos campos: ${fields}
1. Componente React con react-hook-form
2. Validación con Zod
3. Estilos con Tailwind y shadcn/ui
4. Endpoint para guardar los datos`
  }
};

export async function generateFromTemplate(
  templateKey: keyof typeof MODULE_TEMPLATES,
  params: any
): Promise<CodeGenerationResult> {
  const template = MODULE_TEMPLATES[templateKey];
  if (!template) {
    return { success: false, error: `Template '${templateKey}' no encontrado` };
  }
  
  let prompt: string;
  if (templateKey === 'form') {
    const formTemplate = template as typeof MODULE_TEMPLATES.form;
    prompt = formTemplate.prompt(params.name, params.fields);
  } else {
    const simpleTemplate = template as typeof MODULE_TEMPLATES.crud;
    prompt = simpleTemplate.prompt(params.name || params.entityName);
  }
  
  return generateCode({ prompt, preview: params.preview });
}
