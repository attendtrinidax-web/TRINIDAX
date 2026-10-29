# TRINIDAX Attendance Management System

Starter project for a responsive attendance web app and Android wrapper using Google Apps Script, Google Sheets, and Google Drive.

## Included
- Admin, staff, and student roles
- User registration and login
- Admin user listing/deletion
- Password change
- GPS attendance check-in and geofence validation
- Google Sheets storage for users and attendance
- Google Drive folder setup for file storage
- Responsive UI
- Optional Android wrapper using Capacitor

## Important before deployment
This is a starter implementation, not a security-audited production system. Google Apps Script web apps can be deployed with broad access; review deployment permissions and test with non-sensitive data first. For a school/company deployment, consider Google Identity/OAuth or a dedicated authentication backend, audit logging, backups, and an administrator-controlled allowlist.

## 1. Create the Google backend
1. Visit https://script.google.com and create a new project.
2. Copy `Code.gs` into the script editor.
3. Copy `Index.html` into an HTML file named `Index`.
4. In `appsscript.json`, enable the manifest file and paste the included manifest.
5. In Project Settings, set the correct time zone.
6. Run `setupTrinidax()` once from the editor and approve permissions. It creates a spreadsheet and Drive folder, then logs their IDs/URLs.
7. Set script properties:
   - `ADMIN_EMAIL`: email address of the initial administrator (optional)
   - `GEOFENCE_LAT`: latitude of your approved attendance location
   - `GEOFENCE_LNG`: longitude of your approved attendance location
   - `GEOFENCE_RADIUS_METERS`: allowed radius (default 150)
8. Deploy > New deployment > Web app. Execute as **you**. Choose access appropriate for your organization. Do not choose broad public access unless you understand the implications.
9. Open the web app URL and complete the initial admin setup flow if no admin exists.

## 2. Android app
The Android wrapper uses Capacitor and loads the deployed Apps Script URL.

1. Install Node.js LTS and Android Studio.
2. In this folder, run:
   ```bash
   npm install
   npx cap add android
   ```
3. Edit `capacitor.config.json` and replace `YOUR_DEPLOYED_APPS_SCRIPT_WEB_APP_URL` with your deployed `/exec` URL.
4. Run:
   ```bash
   npx cap sync android
   npx cap open android
   ```
5. In Android Studio, configure app signing and test location permissions on a real device. Do not publish until privacy policy, permission disclosures, and security review are complete.

## Data layout
The backend creates these Sheets tabs:
- `Users`: userId, fullName, email, role, passwordHash, salt, createdAt, active
- `Attendance`: attendanceId, userId, fullName, role, timestamp, date, status, latitude, longitude, distanceMeters
- `Settings`: key, value

Drive folder is created for future profile photo/document storage. This starter does not yet include photo upload UI.

## Operational notes
- Attendance is limited to one check-in per user per local date.
- Admin deletion marks a user inactive rather than physically deleting historical records.
- Passwords are hashed with a per-user salt using SHA-256. For high-risk production systems, use a dedicated identity provider and modern password hashing on a server designed for it.
- Geolocation requires HTTPS and user permission.
