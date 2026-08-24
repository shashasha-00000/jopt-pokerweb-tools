function setupCalendarIntegration() {
  var calendar = CalendarApp.getDefaultCalendar();
  if (!calendar) throw new Error('无法读取默认 Google Calendar。');
  logRun_('INFO', 'Google Calendar 连接完成。', { calendarName: calendar.getName() });
}

function syncDeadlineCalendarForRow_(sheet, rowNumber, task) {
  var deadline = parseTokyoDateOnly_(task.deadline);
  var eventId = cleanDashboardValue_(
    sheet.getRange(rowNumber, CONFIG.COL.CALENDAR_EVENT_ID).getValue()
  );

  if (!task.syncCalendar || !deadline) {
    if (eventId) deleteDeadlineCalendarEvent_(eventId);
    sheet.getRange(rowNumber, CONFIG.COL.CALENDAR_EVENT_ID).clearContent();
    sheet.getRange(rowNumber, CONFIG.COL.SYNC_CALENDAR).setValue(false);
    return;
  }

  var calendar = CalendarApp.getDefaultCalendar();
  if (!calendar) throw new Error('无法读取默认 Google Calendar。');
  var event = eventId ? calendar.getEventById(eventId) : null;
  var description = buildDeadlineCalendarDescription_(sheet, rowNumber, task);
  if (event) {
    event
      .setTitle('[DL] ' + task.title)
      .setAllDayDate(deadline)
      .setDescription(description)
      .resetRemindersToDefault();
  } else {
    event = calendar.createAllDayEvent('[DL] ' + task.title, deadline, {
      description: description
    });
    event.resetRemindersToDefault();
  }

  sheet.getRange(rowNumber, CONFIG.COL.CALENDAR_EVENT_ID).setValue(event.getId());
  sheet.getRange(rowNumber, CONFIG.COL.SYNC_CALENDAR).setValue(true);
}

function removeDeadlineCalendarForRow_(sheet, rowNumber) {
  var eventId = cleanDashboardValue_(
    sheet.getRange(rowNumber, CONFIG.COL.CALENDAR_EVENT_ID).getValue()
  );
  if (eventId) deleteDeadlineCalendarEvent_(eventId);
  sheet.getRange(rowNumber, CONFIG.COL.CALENDAR_EVENT_ID).clearContent();
  sheet.getRange(rowNumber, CONFIG.COL.SYNC_CALENDAR).setValue(false);
}

function deleteDeadlineCalendarEvent_(eventId) {
  var calendar = CalendarApp.getDefaultCalendar();
  if (!calendar) throw new Error('无法读取默认 Google Calendar。');
  var event = calendar.getEventById(eventId);
  if (event) event.deleteEvent();
}

function buildDeadlineCalendarDescription_(sheet, rowNumber, task) {
  var slackUrl = cleanDashboardValue_(sheet.getRange(rowNumber, CONFIG.COL.SLACK_URL).getValue());
  var lines = ['任务雷达'];
  if (task.nextAction) lines.push('下一步: ' + task.nextAction);
  if (task.completion) lines.push('完成条件: ' + task.completion);
  if (slackUrl) lines.push('Slack: ' + slackUrl);
  return lines.join('\n');
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
