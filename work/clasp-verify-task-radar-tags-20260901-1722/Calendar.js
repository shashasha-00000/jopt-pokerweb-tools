function setupCalendarIntegration() {
  var calendar = Calendar.CalendarList.get('primary');
  if (!calendar) throw new Error('无法读取默认 Google Calendar。');
  logRun_('INFO', 'Google Calendar 连接完成。', { calendarName: calendar.summary });
}

function syncCalendarReminderForRow_(sheet, rowNumber, task) {
  var reminderAt = parseTokyoDateTimeInput_(task.calendarReminderAt);
  var eventId = cleanDashboardValue_(
    sheet.getRange(rowNumber, CONFIG.COL.CALENDAR_EVENT_ID).getValue()
  );

  if (!task.syncCalendar || !reminderAt) {
    if (eventId) deleteCalendarEventByStoredId_(eventId);
    sheet.getRange(rowNumber, CONFIG.COL.CALENDAR_EVENT_ID).clearContent();
    sheet.getRange(rowNumber, CONFIG.COL.SYNC_CALENDAR).setValue(false);
    return;
  }

  var legacyEventId = '';
  if (eventId && eventId.indexOf('@') !== -1) {
    legacyEventId = eventId;
    eventId = '';
  }

  var endAt = new Date(reminderAt.getTime() + 15 * 60 * 1000);
  var guestEmails = parseCalendarGuestEmails_(task.calendarGuestEmails);
  var resource = {
    summary: '[提醒] ' + task.title,
    description: buildCalendarReminderDescription_(sheet, rowNumber, task),
    start: {
      dateTime: formatTokyoRfc3339_(reminderAt),
      timeZone: CONFIG.TIME_ZONE
    },
    end: {
      dateTime: formatTokyoRfc3339_(endAt),
      timeZone: CONFIG.TIME_ZONE
    },
    attendees: guestEmails.map(function(email) { return { email: email }; }),
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 0 }]
    }
  };
  var event;
  if (eventId) {
    try {
      event = Calendar.Events.patch(resource, 'primary', eventId, { sendUpdates: 'all' });
    } catch (error) {
      if (!/404|not found/i.test(String(error && error.message || error))) throw error;
      event = Calendar.Events.insert(resource, 'primary', { sendUpdates: 'all' });
    }
  } else {
    event = Calendar.Events.insert(resource, 'primary', { sendUpdates: 'all' });
  }
  if (legacyEventId) deleteCalendarEventByStoredId_(legacyEventId);

  sheet.getRange(rowNumber, CONFIG.COL.CALENDAR_EVENT_ID).setValue(event.id);
  sheet.getRange(rowNumber, CONFIG.COL.SYNC_CALENDAR).setValue(true);
}

function parseCalendarGuestEmails_(value) {
  return String(value || '').split(',').map(function(email) {
    return email.trim().toLowerCase();
  }).filter(Boolean);
}

function removeCalendarReminderForRow_(sheet, rowNumber) {
  var eventId = cleanDashboardValue_(
    sheet.getRange(rowNumber, CONFIG.COL.CALENDAR_EVENT_ID).getValue()
  );
  if (eventId) deleteCalendarEventByStoredId_(eventId);
  sheet.getRange(rowNumber, CONFIG.COL.CALENDAR_EVENT_ID).clearContent();
  sheet.getRange(rowNumber, CONFIG.COL.SYNC_CALENDAR).setValue(false);
}

function deleteCalendarEventByStoredId_(eventId) {
  if (eventId.indexOf('@') !== -1) {
    var legacyEvent = CalendarApp.getDefaultCalendar().getEventById(eventId);
    if (legacyEvent) legacyEvent.deleteEvent();
    return;
  }
  try {
    Calendar.Events.remove('primary', eventId, { sendUpdates: 'all' });
  } catch (error) {
    if (!/404|not found/i.test(String(error && error.message || error))) throw error;
  }
}

function buildCalendarReminderDescription_(sheet, rowNumber, task) {
  var slackUrl = cleanDashboardValue_(sheet.getRange(rowNumber, CONFIG.COL.SLACK_URL).getValue());
  var lines = ['任务雷达'];
  if (task.deadline) lines.push('截止日期: ' + task.deadline);
  if (task.nextAction) lines.push('下一步: ' + task.nextAction);
  if (task.completion) lines.push('完成条件: ' + task.completion);
  if (slackUrl) lines.push('Slack: ' + slackUrl);
  return lines.join('\n');
}

function parseTokyoDateTimeInput_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return new Date(value.getTime());
  }
  var match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  var canonical = match.slice(1).join('');
  var date = new Date(
    match[1] + '-' + match[2] + '-' + match[3] + 'T' + match[4] + ':' + match[5] + ':00+09:00'
  );
  if (isNaN(date.getTime())) return null;
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, 'yyyyMMddHHmm') === canonical ? date : null;
}

function formatTokyoDateTimeInput_(value) {
  var date = parseTokyoDateTimeInput_(value);
  return date ? Utilities.formatDate(date, CONFIG.TIME_ZONE, "yyyy-MM-dd'T'HH:mm") : '';
}

function formatTokyoRfc3339_(date) {
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ss") + '+09:00';
}

function parseTokyoDateOnly_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return new Date(Date.UTC(
      Number(Utilities.formatDate(value, CONFIG.TIME_ZONE, 'yyyy')),
      Number(Utilities.formatDate(value, CONFIG.TIME_ZONE, 'M')) - 1,
      Number(Utilities.formatDate(value, CONFIG.TIME_ZONE, 'd')),
      3, 0, 0
    ));
  }
  var match = String(value || '').trim().match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (!match) return null;
  var canonical = match[1] + '-' + String(Number(match[2])).padStart(2, '0') + '-' +
    String(Number(match[3])).padStart(2, '0');
  var date = new Date(Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]), 3, 0, 0
  ));
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, 'yyyy-MM-dd') === canonical ? date : null;
}

function formatTokyoDateInput_(value) {
  var date = parseTokyoDateOnly_(value);
  return date ? Utilities.formatDate(date, CONFIG.TIME_ZONE, 'yyyy-MM-dd') : '';
}

function daysUntilTokyoDate_(value, now) {
  var deadline = parseTokyoDateOnly_(value);
  if (!deadline) return null;
  var today = parseTokyoDateOnly_(Utilities.formatDate(now, CONFIG.TIME_ZONE, 'yyyy-MM-dd'));
  return Math.round((deadline.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}
