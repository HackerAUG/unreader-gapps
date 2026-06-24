const express = require('express');
const { google } = require('googleapis');
const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.CLIENT_ID;

// In-memory token store (Resets if Render container restarts)
let savedTokens = null; 
let currentDeviceCode = null;
let userCodeStr = "";
let verificationUrlStr = "";

const oauth2Client = new google.auth.OAuth2(CLIENT_ID);
const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
const tasks = google.tasks({ version: 'v1', auth: oauth2Client });

// Main Dashboard Endpoint
app.get('/', async (req, res) => {
  // Scenario A: If already logged in, show the actual workspace data
  if (savedTokens) {
    oauth2Client.setCredentials(savedTokens);
    return renderDashboard(res);
  }

  // Scenario B: If a device pairing request is currently active, poll for status
  if (currentDeviceCode) {
    try {
      const tokenRes = await oauth2Client.request({
        url: 'https://googleapis.com',
        method: 'POST',
        data: {
          client_id: CLIENT_ID,
          device_code: currentDeviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        }
      });

      if (tokenRes.data && tokenRes.data.access_token) {
        savedTokens = tokenRes.data;
        oauth2Client.setCredentials(savedTokens);
        currentDeviceCode = null; // Pairing complete
        return renderDashboard(res);
      }
    } catch (err) {
      if (err.response && err.response.data && err.response.data.error !== 'authorization_pending') {
        // Code expired or failed, clear state to force generation of a new code
        currentDeviceCode = null;
      }
    }
    return renderLoginScreen(res, userCodeStr, verificationUrlStr);
  }

  // Scenario C: First load or expired code, request a fresh verification code from Google
  try {
    const deviceRes = await oauth2Client.request({
      url: 'https://googleapis.com',
      method: 'POST',
      data: {
        client_id: CLIENT_ID,
        scope: 'https://googleapis.com https://googleapis.com'
      }
    });

    currentDeviceCode = deviceRes.data.device_code;
    userCodeStr = deviceRes.data.user_code;
    verificationUrlStr = deviceRes.data.verification_url;

    return renderLoginScreen(res, userCodeStr, verificationUrlStr);
  } catch (error) {
    console.error(error);
    return res.send("<h1>Setup Error</h1><p>Ensure your CLIENT_ID environment variable is correctly set up on Render.</p>");
  }
});

// Render the E-Ink login screen instructing user to log in on phone/PC
function renderLoginScreen(res, userCode, url) {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="refresh" content="7"> <!-- Kindle checks if you logged in every 7 secs -->
      <style>
        body { background-color: #FFF; color: #000; font-family: "Courier New", monospace; text-align: center; margin-top: 50px; }
        .box { border: 5px solid #000; padding: 20px; display: inline-block; font-size: 24px; font-weight: bold; margin: 20px 0; }
        p { font-size: 16px; line-height: 1.5; }
      </style>
    </head>
    <body>
      <h2>PAIR YOUR DEVICE</h2>
      <p>On your phone or computer, go to:</p>
      <p><strong>${url}</strong></p>
      <p>And enter this code:</p>
      <div class="box">${userCode}</div>
      <p>This screen will automatically refresh and load your dashboard once authorized.</p>
    </body>
    </html>
  `);
}

// Render the actual data dashboard
async function renderDashboard(res) {
  let calendarHtml = '';
  let tasksHtml = '';
  const todayStr = new Date().toLocaleDateString("en-US", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  try {
    const now = new Date();
    const startOfDay = new Date(now.setHours(0,0,0,0)).toISOString();
    const endOfDay = new Date(now.setHours(23,59,59,999)).toISOString();

    const calRes = await calendar.events.list({ calendarId: 'primary', timeMin: startOfDay, timeMax: endOfDay, singleEvents: true, orderBy: 'startTime' });
    const events = calRes.data.items || [];
    calendarHtml = events.length === 0 ? '<li>No events today.</li>' : events.map(e => `<li>${new Date(e.start.dateTime || e.start.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - ${e.summary}</li>`).join('');

    const taskListRes = await tasks.tasklists.list({ maxResults: 1 });
    if (taskListRes.data.items && taskListRes.data.items.length > 0) {
      const taskRes = await tasks.tasks.list({ tasklist: taskListRes.data.items[0].id, status: 'needsAction' });
      const taskItems = taskRes.data.items || [];
      tasksHtml = taskItems.length === 0 ? '<li>No tasks.</li>' : taskItems.map(t => `<li>[ ] ${t.title}</li>`).join('');
    } else { tasksHtml = '<li>No task list found.</li>'; }
  } catch (error) {
    calendarHtml = '<li>Session expired. Please reload page to repair.</li>';
    savedTokens = null; // clear tokens on explicit error to trigger a re-login screen
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="refresh" content="1800"> <!-- Refresh calendar data every 30 mins -->
      <style>
        body { background-color: #FFF; color: #000; font-family: "Courier New", monospace; margin: 20px; }
        h1 { font-size: 26px; border-bottom: 5px solid #000; padding-bottom: 5px; margin-bottom: 5px; text-transform: uppercase; }
        .date { font-size: 14px; margin-bottom: 25px; font-weight: bold; }
        h2 { font-size: 18px; background-color: #000; color: #FFF; padding: 6px; margin-top: 25px; text-transform: uppercase; }
        ul { list-style-type: square; padding-left: 20px; }
        li { font-size: 16px; margin-bottom: 10px; line-height: 1.4; }
      </style>
    </head>
    <body>
      <h1>Workspace Dashboard</h1>
      <div class="date">${todayStr}</div>
      <h2>Today's Schedule</h2>
      <ul>${calendarHtml}</ul>
      <h2>Action Items</h2>
      <ul>${tasksHtml}</ul>
    </body>
    </html>
  `);
}

app.listen(PORT, () => console.log(`E-Ink Device Flow App running on port ${PORT}`));
