const APP_NAME = 'TRINIDAX';
const USERS_SHEET = 'Users';
const ATTENDANCE_SHEET = 'Attendance';
const SETTINGS_SHEET = 'Settings';

function doGet() {
  setupIfNeeded_();
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP_NAME + ' Attendance')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function setupTrinidax() {
  const props = PropertiesService.getScriptProperties();
  let ssId = props.getProperty('TRINIDAX_SHEET_ID');
  let ss;
  if (ssId) {
    ss = SpreadsheetApp.openById(ssId);
  } else {
    ss = SpreadsheetApp.create('TRINIDAX Attendance Database');
    props.setProperty('TRINIDAX_SHEET_ID', ss.getId());
  }
  ensureSheet_(ss, USERS_SHEET, ['userId','fullName','email','role','passwordHash','salt','createdAt','active']);
  ensureSheet_(ss, ATTENDANCE_SHEET, ['attendanceId','userId','fullName','role','timestamp','date','status','latitude','longitude','distanceMeters']);
  ensureSheet_(ss, SETTINGS_SHEET, ['key','value']);
  let folderId = props.getProperty('TRINIDAX_DRIVE_FOLDER_ID');
  if (!folderId) {
    const folder = DriveApp.createFolder('TRINIDAX Attendance Files');
    folderId = folder.getId();
    props.setProperty('TRINIDAX_DRIVE_FOLDER_ID', folderId);
  }
  Logger.log('Spreadsheet: ' + ss.getUrl());
  Logger.log('Drive folder: https://drive.google.com/drive/folders/' + folderId);
  return { spreadsheetUrl: ss.getUrl(), driveFolderId: folderId };
}

function setupIfNeeded_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TRINIDAX_SHEET_ID')) setupTrinidax();
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(headers);
}

function ok_(data) { return { ok:true, data:data }; }

function api(action, payload) {
  try {
    setupIfNeeded_();
    payload = payload || {};
    switch (action) {
      case 'bootstrap': return ok_(bootstrap_());
      case 'register': return ok_(register_(payload));
      case 'login': return ok_(login_(payload));
      case 'changePassword': return ok_(changePassword_(payload));
      case 'listUsers': return ok_(listUsers_(payload));
      case 'deleteUser': return ok_(deleteUser_(payload));
      case 'checkIn': return ok_(checkIn_(payload));
      case 'myAttendance': return ok_(myAttendance_(payload));
      case 'allAttendance': return ok_(allAttendance_(payload));
      case 'getConfig': return ok_(getConfig_());
      default: throw new Error('Unknown action.');
    }
  } catch (e) {
    return { ok:false, error:String(e && e.message ? e.message : e) };
  }
}

function bootstrap_() {
  const users = getRows_(USERS_SHEET);
  return {
    appName: APP_NAME,
    needsAdmin: !users.some(u => u.role === 'admin' && u.active === true),
    geofenceConfigured: Boolean(PropertiesService.getScriptProperties().getProperty('GEOFENCE_LAT') &&
      PropertiesService.getScriptProperties().getProperty('GEOFENCE_LNG'))
  };
}

function register_(p) {
  const fullName = clean_(p.fullName, 100);
  const email = clean_(p.email, 160).toLowerCase();
  const role = String(p.role || '').toLowerCase();
  const password = String(p.password || '');
  if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid name and email.');
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
  if (!['admin','staff','student'].includes(role)) throw new Error('Invalid role.');
  const users = getRows_(USERS_SHEET);
  const isFirstAdmin = role === 'admin' && !users.some(u => u.role === 'admin' && u.active === true);
  if (role === 'admin' && isFirstAdmin) {
    const allowedAdminEmail = String(PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL') || '').trim().toLowerCase();
    if (!allowedAdminEmail || email !== allowedAdminEmail) throw new Error('Initial administrator registration is restricted to the ADMIN_EMAIL configured by the owner.');
  } else if (role === 'admin') {
    requireRole_(p.token, ['admin']);
  } else {
    // Public self-registration is restricted to staff/student roles.
    if (role !== 'student' && role !== 'staff') throw new Error('Invalid role.');
  }
  if (users.some(u => u.email === email && u.active === true)) throw new Error('An active account with this email already exists.');
  const salt = Utilities.getUuid().replace(/-/g, '');
  const hash = hashPassword_(password, salt);
  const user = { userId:Utilities.getUuid(), fullName, email, role, passwordHash:hash, salt,
    createdAt:new Date(), active:true };
  appendObject_(USERS_SHEET, user);
  return { message:'Account created. You can now sign in.', user:{ fullName, email, role } };
}

function login_(p) {
  const email = clean_(p.email, 160).toLowerCase();
  const password = String(p.password || '');
  const user = getRows_(USERS_SHEET).find(u => u.email === email && u.active === true);
  if (!user || hashPassword_(password, user.salt) !== user.passwordHash) throw new Error('Email or password is incorrect.');
  const token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('session_' + token, JSON.stringify({
    userId:user.userId, email:user.email, role:user.role, fullName:user.fullName
  }), 21600);
  return { token, user:{ userId:user.userId, fullName:user.fullName, email:user.email, role:user.role } };
}

function changePassword_(p) {
  const session = requireSession_(p.token);
  const oldPassword = String(p.oldPassword || '');
  const newPassword = String(p.newPassword || '');
  if (newPassword.length < 8) throw new Error('New password must be at least 8 characters.');
  const user = getRows_(USERS_SHEET).find(u => u.userId === session.userId && u.active === true);
  if (!user || hashPassword_(oldPassword, user.salt) !== user.passwordHash) throw new Error('Current password is incorrect.');
  const salt = Utilities.getUuid().replace(/-/g, '');
  updateUserFields_(user.userId, { passwordHash:hashPassword_(newPassword, salt), salt });
  return { message:'Password updated successfully.' };
}

function listUsers_(p) {
  requireRole_(p.token, ['admin']);
  return getRows_(USERS_SHEET).filter(u => u.active === true).map(u => ({
    userId:u.userId, fullName:u.fullName, email:u.email, role:u.role, createdAt:u.createdAt
  }));
}

function deleteUser_(p) {
  requireRole_(p.token, ['admin']);
  const userId = String(p.userId || '');
  const target = getRows_(USERS_SHEET).find(u => u.userId === userId && u.active === true);
  if (!target) throw new Error('User not found.');
  if (target.role === 'admin' && getRows_(USERS_SHEET).filter(u => u.role === 'admin' && u.active === true).length <= 1) {
    throw new Error('You cannot deactivate the last active administrator.');
  }
  updateUserFields_(userId, { active:false });
  return { message:'User deactivated. Historical attendance records are preserved.' };
}

function checkIn_(p) {
  const session = requireSession_(p.token);
  const lat = Number(p.latitude), lng = Number(p.longitude);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new Error('Location is unavailable. Allow location access and try again.');
  }
  const cfg = getConfig_();
  let distance = null;
  if (cfg.geofenceLat !== null && cfg.geofenceLng !== null) {
    distance = Math.round(distanceMeters_(lat, lng, cfg.geofenceLat, cfg.geofenceLng));
    if (distance > cfg.radiusMeters) throw new Error('You are outside the approved attendance area (' + distance + ' m away).');
  }
  const user = getRows_(USERS_SHEET).find(u => u.userId === session.userId && u.active === true);
  if (!user) throw new Error('Account is inactive.');
  const now = new Date();
  const date = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const already = getRows_(ATTENDANCE_SHEET).some(a => a.userId === user.userId && a.date === date);
  if (already) throw new Error('You have already checked in today.');
  appendObject_(ATTENDANCE_SHEET, {
    attendanceId:Utilities.getUuid(), userId:user.userId, fullName:user.fullName, role:user.role,
    timestamp:now, date, status:'Present', latitude:lat, longitude:lng, distanceMeters:distance
  });
  return { message:'Attendance marked successfully.', date, time:Utilities.formatDate(now, Session.getScriptTimeZone(), 'HH:mm:ss'), distanceMeters:distance };
}

function myAttendance_(p) {
  const session = requireSession_(p.token);
  return getRows_(ATTENDANCE_SHEET).filter(a => a.userId === session.userId)
    .sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0,100).map(cleanAttendance_);
}

function allAttendance_(p) {
  requireRole_(p.token, ['admin']);
  return getRows_(ATTENDANCE_SHEET).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0,500).map(cleanAttendance_);
}

function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  const lat = props.getProperty('GEOFENCE_LAT');
  const lng = props.getProperty('GEOFENCE_LNG');
  return { geofenceLat:lat === null || lat === '' ? null : Number(lat),
    geofenceLng:lng === null || lng === '' ? null : Number(lng),
    radiusMeters:Number(props.getProperty('GEOFENCE_RADIUS_METERS') || 150) };
}

function cleanAttendance_(a) {
  return { fullName:a.fullName, role:a.role, timestamp:a.timestamp, date:a.date, status:a.status,
    latitude:a.latitude, longitude:a.longitude, distanceMeters:a.distanceMeters };
}
function requireRole_(token, roles) {
  const s = requireSession_(token);
  if (!roles.includes(s.role)) throw new Error('You do not have permission to perform this action.');
  return s;
}
function requireSession_(token) {
  if (!token) throw new Error('Please sign in again.');
  const raw = CacheService.getScriptCache().get('session_' + token);
  if (!raw) throw new Error('Your session expired. Please sign in again.');
  return JSON.parse(raw);
}
function hashPassword_(password, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + String(password), Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}
function getRows_(sheetName) {
  const id = PropertiesService.getScriptProperties().getProperty('TRINIDAX_SHEET_ID');
  const sh = SpreadsheetApp.openById(id).getSheetByName(sheetName);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values.shift();
  return values.filter(r => r.some(v => v !== '')).map(r => {
    const o = {};
    headers.forEach((h,i) => o[h] = r[i]);
    o.active = o.active === true || String(o.active).toLowerCase() === 'true';
    return o;
  });
}
function appendObject_(sheetName, obj) {
  const id = PropertiesService.getScriptProperties().getProperty('TRINIDAX_SHEET_ID');
  const sh = SpreadsheetApp.openById(id).getSheetByName(sheetName);
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  sh.appendRow(headers.map(h => obj[h] === undefined ? '' : obj[h]));
}
function updateUserFields_(userId, fields) {
  const id = PropertiesService.getScriptProperties().getProperty('TRINIDAX_SHEET_ID');
  const sh = SpreadsheetApp.openById(id).getSheetByName(USERS_SHEET);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf('userId');
  Object.keys(fields).forEach(field => {
    const col = headers.indexOf(field);
    if (col < 0) return;
    for (let r=1; r<values.length; r++) {
      if (String(values[r][idCol]) === String(userId)) {
        sh.getRange(r+1, col+1).setValue(fields[field]);
        break;
      }
    }
  });
}
function distanceMeters_(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2-lat1)*rad, dLon = (lon2-lon1)*rad;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function clean_(v, max) { return String(v || '').trim().slice(0,max); }
