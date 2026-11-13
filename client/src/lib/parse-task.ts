import { addDays, startOfWeek, format, addWeeks, startOfDay } from "date-fns";
import { es } from "date-fns/locale";

const DAYS_OF_WEEK: Record<string, number> = {
  lunes: 0,
  monday: 0,
  martes: 1,
  tuesday: 1,
  miércoles: 2,
  miercoles: 2,
  wednesday: 2,
  jueves: 3,
  thursday: 3,
  viernes: 4,
  friday: 4,
  sábado: 5,
  sabado: 5,
  saturday: 5,
  domingo: 6,
  sunday: 6,
};

const PRIORITY_KEYWORDS = {
  urgente: "high",
  importante: "high",
  asap: "high",
  normal: "normal",
  bajo: "low",
  baja: "low",
};

const MONTHS: Record<string, number> = {
  // Español
  enero: 0, ene: 0,
  febrero: 1, feb: 1,
  marzo: 2, mar: 2,
  abril: 3, abr: 3,
  mayo: 4, may: 4,
  junio: 5, jun: 5,
  julio: 6, jul: 6,
  agosto: 7, ago: 7,
  septiembre: 8, sep: 8, sept: 8,
  octubre: 9, oct: 9,
  noviembre: 10, nov: 10,
  diciembre: 11, dic: 11,
  // English
  january: 0, jan: 0,
  february: 1,
  march: 2,
  april: 3, apr: 3,
  june: 5,
  july: 6,
  august: 7, aug: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11, dec: 11,
};

export interface ParsedTask {
  title: string;
  date: Date;
  priority: string;
  hour?: number;
  minute?: number;
  isRecurring?: boolean;
  recurrencePattern?: "daily" | "weekly" | "weekly_except";
  recurringDays?: number[]; // días específicos para weekly, o días a EXCLUIR para daily
  recurrenceWeeks?: number; // cuántas semanas crear (default 4)
}

export function parseTaskInput(input: string): ParsedTask | null {
  if (!input.trim()) return null;

  const lowerInput = input.toLowerCase().trim();

  // Detectar patrones de recurrencia
  let isRecurring = false;
  let recurrencePattern: "daily" | "weekly" | "weekly_except" | null = null;
  let recurringDays: number[] = [];
  let recurrenceWeeks = 52; // 52 semanas = 1 año completo

  // "next 3 mondays", "próximos 3 lunes", "los próximos 5 viernes"
  const nextNDaysMatch = lowerInput.match(/(?:next|pr[oó]ximos?|los pr[oó]ximos?)\s+(\d+)\s+(\w+)/i);
  if (nextNDaysMatch) {
    const count = parseInt(nextNDaysMatch[1]);
    const dayWord = nextNDaysMatch[2].toLowerCase();
    
    // Buscar el día en el mapa
    const dayEntries = Object.entries(DAYS_OF_WEEK).sort((a, b) => b[0].length - a[0].length);
    for (const [dayName, dayIndex] of dayEntries) {
      // Manejar plural: "mondays" -> "monday", "lunes" -> "lunes"
      const singularDay = dayWord.replace(/s$/, '');
      if (dayName === dayWord || dayName === singularDay || dayName.startsWith(singularDay)) {
        isRecurring = true;
        recurrencePattern = "weekly";
        recurringDays = [dayIndex];
        recurrenceWeeks = count;
        break;
      }
    }
  }

  // "todos los jueves", "every thursday"
  if (!isRecurring && lowerInput.includes("todos los") && !lowerInput.includes("día")) {
    isRecurring = true;
    recurrencePattern = "weekly";
    // Buscar día específico - ordenar por longitud para evitar coincidencias parciales
    const dayEntries = Object.entries(DAYS_OF_WEEK).sort((a, b) => b[0].length - a[0].length);
    for (const [dayName, dayIndex] of dayEntries) {
      if (lowerInput.includes(dayName)) {
        recurringDays = [dayIndex];
        break;
      }
    }
  }

  // "todos los días" (todos excepto algunos específicos)
  if (lowerInput.includes("todos los días") || lowerInput.includes("todos los días")) {
    isRecurring = true;
    recurrencePattern = "daily";
    recurringDays = [];

    // Buscar excepciones: "todos los días menos lunes"
    if (lowerInput.includes("menos")) {
      recurrencePattern = "weekly_except";
      const exceptMatch = lowerInput.match(/menos\s+(.*?)(?:\s+a las|\s+$)/);
      if (exceptMatch) {
        const exceptDays = exceptMatch[1].split(/[,y]/);
        for (const dayName of Object.keys(DAYS_OF_WEEK)) {
          if (exceptDays.some(d => d.includes(dayName))) {
            recurringDays.push(DAYS_OF_WEEK[dayName]);
          }
        }
      }
    } else {
      recurringDays = [0, 1, 2, 3, 4, 5, 6]; // todos los días
    }
  }

  // Parsear hora - soporta "a las X", "de X", "X-Y"
  let hour = 9; // default
  let minute = 0;
  let timeMatch = lowerInput.match(/(?:a las|de)\s+(\d{1,2})(?::(\d{2}))?(?:\s*(?:pm|am))?/);
  
  if (timeMatch) {
    hour = parseInt(timeMatch[1]);
    minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    
    if (lowerInput.includes("pm") && hour < 12) {
      hour += 12;
    }
  }

  // Si es recurrente, usar hoy como fecha base
  let targetDate = new Date();
  targetDate.setHours(hour, minute, 0, 0);
  
  // Detectar fecha específica: "SEP 20", "septiembre 20", "20 de septiembre", "20 sep"
  let specificDateFound = false;
  
  // Patrón 1: MES DIA (ej: "sep 20", "septiembre 20")
  const monthDayPattern = /\b([a-záéíóúñ]+)\s+(\d{1,2})\b/gi;
  let monthDayMatch;
  while ((monthDayMatch = monthDayPattern.exec(lowerInput)) !== null) {
    const monthName = monthDayMatch[1].toLowerCase();
    const day = parseInt(monthDayMatch[2]);
    
    if (MONTHS[monthName] !== undefined && day >= 1 && day <= 31) {
      const month = MONTHS[monthName];
      const now = new Date();
      let year = now.getFullYear();
      
      // Si la fecha ya pasó este año, usar el próximo año
      const candidateDate = new Date(year, month, day, hour, minute, 0, 0);
      if (candidateDate < now) {
        year++;
      }
      
      targetDate = new Date(year, month, day, hour, minute, 0, 0);
      specificDateFound = true;
      break;
    }
  }
  
  // Patrón 2: DIA de MES (ej: "20 de septiembre", "20 sep")
  if (!specificDateFound) {
    const dayMonthPattern = /\b(\d{1,2})\s+(?:de\s+)?([a-záéíóúñ]+)\b/gi;
    let dayMonthMatch;
    while ((dayMonthMatch = dayMonthPattern.exec(lowerInput)) !== null) {
      const day = parseInt(dayMonthMatch[1]);
      const monthName = dayMonthMatch[2].toLowerCase();
      
      if (MONTHS[monthName] !== undefined && day >= 1 && day <= 31) {
        const month = MONTHS[monthName];
        const now = new Date();
        let year = now.getFullYear();
        
        // Si la fecha ya pasó este año, usar el próximo año
        const candidateDate = new Date(year, month, day, hour, minute, 0, 0);
        if (candidateDate < now) {
          year++;
        }
        
        targetDate = new Date(year, month, day, hour, minute, 0, 0);
        specificDateFound = true;
        break;
      }
    }
  }

  // Detectar día de la semana: "miércoles", "el lunes", "para el viernes", "del martes", "este jueves"
  let simpleDayFound = false;
  let simpleDayIndex = -1;
  if (!specificDateFound && !isRecurring) {
    // Primero intentar con palabras clave
    const dayNames = Object.keys(DAYS_OF_WEEK).join("|");
    const simpleDayPattern = new RegExp(`(?:el|para\\s+el|del|este|esta)\\s+(${dayNames})\\b`, "i");
    let simpleDayMatch = lowerInput.match(simpleDayPattern);
    
    // Si no hay match, buscar día directamente en el texto
    if (!simpleDayMatch) {
      // Ordenar por longitud para evitar coincidencias parciales (miércoles antes que mier)
      const sortedDays = Object.keys(DAYS_OF_WEEK).sort((a, b) => b.length - a.length);
      for (const dayName of sortedDays) {
        // Buscar el día como palabra completa
        const directDayPattern = new RegExp(`\\b(${dayName})\\b`, "i");
        const directMatch = lowerInput.match(directDayPattern);
        if (directMatch) {
          simpleDayMatch = [directMatch[0], directMatch[1]];
          break;
        }
      }
    }
    
    if (simpleDayMatch) {
      const matchedDay = simpleDayMatch[1].toLowerCase();
      if (DAYS_OF_WEEK[matchedDay] !== undefined) {
        simpleDayIndex = DAYS_OF_WEEK[matchedDay];
        simpleDayFound = true;
        
        const today = new Date();
        const todayStart = startOfDay(today);
        const weekStart = startOfWeek(today, { weekStartsOn: 1 });
        const candidateDate = addDays(weekStart, simpleDayIndex);
        
        // If the candidate day is today or in the future this week, use it
        // Only go to next week if the day has already passed
        if (candidateDate < todayStart) {
          targetDate = addDays(candidateDate, 7);
        } else {
          targetDate = candidateDate;
        }
        targetDate.setHours(hour, minute, 0, 0);
      }
    }
  }

  // Si es semanal con día específico, buscar ese día esta semana o la próxima
  if (recurrencePattern === "weekly" && recurringDays.length > 0) {
    const today = new Date();
    const todayStart = startOfDay(today);
    const weekStart = startOfWeek(today, { weekStartsOn: 1 });
    const dayIndex = recurringDays[0];
    const candidateDate = addDays(weekStart, dayIndex);
    
    // If the candidate day is today or in the future this week, use it
    // Only go to next week if the day has already passed
    if (candidateDate < todayStart) {
      targetDate = addDays(candidateDate, 7);
    } else {
      targetDate = candidateDate;
    }
    targetDate.setHours(hour, minute, 0, 0);
  }

  // Prioridad
  let priority = "normal";
  for (const [keyword, priorty] of Object.entries(PRIORITY_KEYWORDS)) {
    if (lowerInput.includes(keyword)) {
      priority = priorty;
      break;
    }
  }

  // Crear patrón dinámico para meses
  const monthNames = Object.keys(MONTHS).join("|");
  const datePatternRegex = new RegExp(`\\b(${monthNames})\\s+\\d{1,2}\\b|\\b\\d{1,2}\\s+(?:de\\s+)?(${monthNames})\\b`, "gi");
  
  // Crear patrón dinámico para días de la semana (con y sin palabras clave)
  const dayNames = Object.keys(DAYS_OF_WEEK).join("|");
  const simpleDayRegex = new RegExp(`(?:para\\s+el|el|del|este|esta)\\s+(${dayNames})\\b`, "gi");
  const directDayRegex = new RegExp(`\\b(${dayNames})\\b`, "gi");
  
  // Título - remover referencias a recurrencia, tiempo y fechas
  let title = lowerInput
    .replace(/(?:next|pr[oó]ximos?|los pr[oó]ximos?)\s+\d+\s+\w+/gi, "")
    .replace(/todos los jueves|todos los viernes|todos los miércoles|todos los miercoles|todos los martes|todos los lunes|todos los sábados|todos los sabados|todos los domingos/gi, "")
    .replace(/todos los días/gi, "")
    .replace(/menos\s+.*?(?:\s+a las|\s+de|\s+$)/gi, "")
    .replace(/(?:a las|de)\s+\d{1,2}(?::\d{2})?(?:\s*(?:pm|am))?(?:-\d{1,2}(?::\d{2})?(?:\s*(?:pm|am))?)?/gi, "")
    .replace(/(urgente|importante|asap|normal|bajo|baja)/gi, "")
    .replace(datePatternRegex, "") // remover fechas específicas (sep 20, 20 de septiembre)
    .replace(simpleDayRegex, "") // remover días con palabras clave (el lunes, para el viernes)
    .replace(directDayRegex, "") // remover días directos (miércoles, jueves)
    .replace(/\s*-\s*$/, "") // remover guión final
    .replace(/,\s*$/, "") // remover coma final
    .replace(/\s+/g, " ") // normalizar espacios múltiples
    .trim();

  if (!title) {
    title = "Nueva tarea recurrente";
  }

  // Capitalizar
  title = title.charAt(0).toUpperCase() + title.slice(1);

  return {
    title,
    date: targetDate,
    priority,
    hour,
    minute,
    isRecurring,
    recurrencePattern: recurrencePattern || undefined,
    recurringDays: recurringDays || [],
    recurrenceWeeks: recurrenceWeeks || 4,
  };
}
