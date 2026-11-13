// Google Calendar Integration - using Replit connector
let connectionSettings: any;
let connectionSettingsCacheKey: string | null = null;

async function getGoogleApis() {
  return (await import("googleapis")).google;
}

export function hasReplitGoogleConnectorEnv() {
  return Boolean(
    process.env.REPLIT_CONNECTORS_HOSTNAME &&
    (process.env.REPL_IDENTITY || process.env.WEB_REPL_RENEWAL)
  );
}

function findAccessToken(value: any, depth = 0): string | null {
  if (!value || depth > 5) return null;
  if (typeof value !== "object") return null;

  for (const key of ["access_token", "accessToken"]) {
    const token = value[key];
    if (typeof token === "string" && token.trim()) return token;
  }

  for (const child of Object.values(value)) {
    const token = findAccessToken(child, depth + 1);
    if (token) return token;
  }

  return null;
}

function readConnectorAccessToken(connection: any): string | null {
  return findAccessToken(connection?.settings);
}

function isConnectorTokenFresh(connection: any): boolean {
  const expiresAt = connection?.settings?.expires_at || connection?.settings?.oauth?.credentials?.expiry_date;
  if (!expiresAt) return Boolean(readConnectorAccessToken(connection));
  const expiryTime = typeof expiresAt === "number" ? expiresAt : new Date(expiresAt).getTime();
  return Number.isFinite(expiryTime) && expiryTime > Date.now();
}

function selectGoogleConnector(items: any[] = []) {
  const connected = items.filter((item) => readConnectorAccessToken(item));
  return (
    connected.find((item) => String(item?.name || item?.connector_name || "").includes("google-drive")) ||
    connected.find((item) => String(item?.name || item?.connector_name || "").includes("google")) ||
    connected[0] ||
    null
  );
}

export async function getGoogleAccessToken() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  const cacheKey = `${hostname || ""}:${xReplitToken || ""}`;
  if (connectionSettings && connectionSettingsCacheKey === cacheKey && isConnectorTokenFresh(connectionSettings)) {
    const cachedToken = readConnectorAccessToken(connectionSettings);
    if (cachedToken) return cachedToken;
  }

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-drive,google-calendar',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => selectGoogleConnector(data.items || []));
  connectionSettingsCacheKey = cacheKey;

  const accessToken = readConnectorAccessToken(connectionSettings);

  if (!connectionSettings || !accessToken) {
    throw new Error('Google connector not connected');
  }
  return accessToken;
}

export async function hasConnectedReplitGoogleConnector(): Promise<boolean> {
  if (!hasReplitGoogleConnectorEnv()) return false;
  try {
    await getGoogleAccessToken();
    return true;
  } catch {
    return false;
  }
}

// WARNING: Never cache this client.
// Access tokens expire, so a new client must be created each time.
export async function getGoogleCalendarClient() {
  const accessToken = await getGoogleAccessToken();

  return getGoogleOAuthCalendarClient(accessToken);
}

export async function getGoogleOAuthClient(accessToken: string) {
  const google = await getGoogleApis();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });

  return oauth2Client;
}

async function getGoogleOAuthCalendarClient(accessToken: string) {
  const google = await getGoogleApis();
  const oauth2Client = await getGoogleOAuthClient(accessToken);
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  endDate?: Date;
  description?: string;
  location?: string;
  isAllDay: boolean;
  source: 'google';
}

function mapEventToCalendarEvent(event: any): CalendarEvent {
  const isAllDay = !event.start?.dateTime;

  let startDate: Date;
  if (isAllDay && event.start?.date) {
    startDate = new Date(event.start.date + 'T12:00:00');
  } else {
    startDate = new Date(event.start?.dateTime || event.start?.date || new Date());
  }

  let endDate: Date | undefined;
  if (event.end?.dateTime) {
    endDate = new Date(event.end.dateTime);
  } else if (event.end?.date) {
    endDate = new Date(event.end.date + 'T12:00:00');
  }

  let fullDescription = '';
  if (event.location) {
    fullDescription += `📍 ${event.location}\n`;
  }
  if (!isAllDay && event.start?.dateTime) {
    const startTime = startDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const endTime = endDate?.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    fullDescription += `⏰ ${startTime}${endTime ? ` - ${endTime}` : ''}\n`;
  }
  if (event.description) {
    fullDescription += event.description;
  }

  return {
    id: event.id || '',
    title: event.summary || 'Sin título',
    date: startDate,
    endDate,
    description: fullDescription.trim() || undefined,
    location: event.location || undefined,
    isAllDay,
    source: 'google' as const,
  };
}

export async function getCalendarEvents(timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
  try {
    const calendar = await getGoogleCalendarClient();

    // Fetch all accessible calendars (not just primary)
    const calListResponse = await calendar.calendarList.list({ minAccessRole: 'reader' });
    const calendarIds = (calListResponse.data.items || []).map((c: any) => c.id).filter(Boolean) as string[];

    // Always include primary, deduplicate
    if (!calendarIds.includes('primary')) calendarIds.unshift('primary');

    const seenIds = new Set<string>();
    const allEvents: CalendarEvent[] = [];

    for (const calId of calendarIds) {
      try {
        const response = await calendar.events.list({
          calendarId: calId,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 500,
        });

        for (const event of response.data.items || []) {
          if (!event.id || seenIds.has(event.id)) continue;
          seenIds.add(event.id);
          allEvents.push(mapEventToCalendarEvent(event));
        }
      } catch (calErr) {
        // Skip calendars we can't read (permissions, etc.)
        console.warn(`Skipping calendar ${calId}:`, (calErr as any).message);
      }
    }

    return allEvents;
  } catch (error) {
    console.error('Error fetching Google Calendar events:', error);
    throw error;
  }
}

export async function isGoogleCalendarConnected(): Promise<boolean> {
  try {
    await getGoogleAccessToken();
    return true;
  } catch {
    return false;
  }
}

export async function updateCalendarEventDescription(eventId: string, newDescription: string): Promise<boolean> {
  try {
    const calendar = await getGoogleCalendarClient();
    
    // First get the current event
    const currentEvent = await calendar.events.get({
      calendarId: 'primary',
      eventId: eventId,
    });
    
    // Update the description
    await calendar.events.patch({
      calendarId: 'primary',
      eventId: eventId,
      requestBody: {
        description: newDescription,
      },
    });
    
    return true;
  } catch (error) {
    console.error('Error updating Google Calendar event:', error);
    throw error;
  }
}

export interface UpdateEventParams {
  eventId: string;
  title?: string;
  date?: string;
  endDate?: string;
  description?: string;
  location?: string;
  isAllDay?: boolean;
}

export async function updateCalendarEvent(params: UpdateEventParams): Promise<boolean> {
  try {
    const calendar = await getGoogleCalendarClient();
    const requestBody: any = {};

    if (params.title !== undefined) requestBody.summary = params.title;
    if (params.description !== undefined) requestBody.description = params.description;
    if (params.location !== undefined) requestBody.location = params.location;

    if (params.date) {
      const startDate = new Date(params.date);
      const endDate = params.endDate
        ? new Date(params.endDate)
        : new Date(startDate.getTime() + 60 * 60 * 1000);

      if (params.isAllDay) {
        requestBody.start = { date: startDate.toISOString().split('T')[0] };
        requestBody.end = { date: endDate.toISOString().split('T')[0] };
      } else {
        requestBody.start = { dateTime: startDate.toISOString(), timeZone: 'America/New_York' };
        requestBody.end = { dateTime: endDate.toISOString(), timeZone: 'America/New_York' };
      }
    }

    await calendar.events.patch({
      calendarId: 'primary',
      eventId: params.eventId,
      requestBody,
    });

    return true;
  } catch (error) {
    console.error('Error editing Google Calendar event:', error);
    throw error;
  }
}

export interface CreateEventParams {
  title: string;
  date: string; // ISO date string for start
  endDate?: string; // ISO date string for end (optional)
  description?: string;
  location?: string;
  isAllDay?: boolean;
}

export async function createCalendarEvent(params: CreateEventParams): Promise<string> {
  try {
    const calendar = await getGoogleCalendarClient();
    
    const startDate = new Date(params.date);
    const endDate = params.endDate ? new Date(params.endDate) : new Date(startDate.getTime() + 60 * 60 * 1000); // Default 1 hour
    
    let eventBody: any = {
      summary: params.title,
      description: params.description,
      location: params.location,
    };
    
    if (params.isAllDay) {
      // All-day event uses date format YYYY-MM-DD
      eventBody.start = { date: startDate.toISOString().split('T')[0] };
      eventBody.end = { date: endDate.toISOString().split('T')[0] };
    } else {
      // Timed event uses dateTime format
      eventBody.start = { dateTime: startDate.toISOString(), timeZone: 'America/New_York' };
      eventBody.end = { dateTime: endDate.toISOString(), timeZone: 'America/New_York' };
    }
    
    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: eventBody,
    });
    
    return response.data.id || '';
  } catch (error) {
    console.error('Error creating Google Calendar event:', error);
    throw error;
  }
}
