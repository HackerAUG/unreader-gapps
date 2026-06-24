const express = require('express');
const { google } = require('googleapis');
const app = express();
const PORT = process.env.PORT || 3000;

// Set up Google OAuth Client using Render Environment Variables
const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  'https://google.com'
);
oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
const tasks = google.tasks({ version: 'v1', auth: oauth2Client });

app.get('/', async (req, res) => {
  let calendarHtml = '';
  let tasksHtml = '';
  const todayStr = new Date().toLocaleDateString("en-US", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  try {
    // 1. Fetch Today's Calendar Events
    const now = new Date();
    const startOfDay = new Date(now.setHours(0,0,0,0)).toISOString();
    const endOfDay = new Date(now.setHours(23,59,59,999)).toISOString();

    const calRes = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startOfDay,
      timeMax: endOfDay,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = calRes.data.items || [];
    if (events.length === 0) {
      calendarHtml = '<li>No events scheduled today.</li>';
    } else {
      events.forEach(event => {
        const start = new Date(event.start.dateTime || event.start.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        calendarHtml += `<li>${start} - ${event.summary}</li>`;
      });
    }

    // 2. Fetch Google Tasks
    const taskListRes = await tasks.tasklists.list({ maxResults: 1 });
    if (taskListRes.data.items && taskListRes.data.items.length > 0) {
      const taskRes = await tasks.tasks.list({
        tasklist: taskListRes.data.items[0].id,
        status: 'needsAction'
      });
      const taskItems = taskRes.data.items || [];
      if (taskItems.length === 0) {
        tasksHtml = '<li>No active tasks.</li>';
      } else {
        taskItems.forEach(task => {
          tasksHtml += `<li>[ ] ${task.title}</li>`;
        });
      }
    } else {
      tasksHtml = '<li>No task list found.</li>';
    }

  } catch (error) {
    console.error(error);
    calendarHtml = '<li>Error loading calendar data. Check configurations.</li>';
    tasksHtml = '<li>Error loading tasks data. Check configurations.</li>';
  }

  // Pure black and white E-Ink HTML Output with 1-hour auto-refresh tag
  const htmlOutput = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="refresh" content="3600">
    <title>Workspace Dashboard</title>
    <style>
      body { background-color: #FFFFFF !important; color: #000000 !important; font-family: "Courier New", Courier, monospace; margin: 20px; }
      h1 { font-size: 26px; border-bottom: 5px solid #000000; padding-bottom: 5px; margin-bottom: 5px; text-transform: uppercase; }
      .date { font-size: 14px; margin-bottom: 25px; font-weight: bold; }
      h2 { font-size: 18px; background-color: #000000; color: #FFFFFF; padding: 6px; margin-top: 25px; text-transform: uppercase; letter-spacing: 1px; }
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
  </html>`;

  res.send(htmlOutput);
});

app.listen(PORT, () => {
  console.log(`E-Ink App listening on port ${PORT}`);
});
