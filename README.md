# PollPoint - Live Polling Web App for Parent-Teacher Meetings

**PollPoint** is an ultra-fast, real-time live polling web application built for college department Parent-Teacher Meetings (PTM) and auditorium presentations. It allows the Head of Department (HOD) to configure questions in a setup builder and project real-time animated charts on screen, while hundreds of parents join anonymously via QR code on venue Wi-Fi without creating accounts.

---

## 🌟 Key Features

### 1. Stage 1: Question Builder ("Set Up Meeting")
- Initial screen shown before launching the live session.
- Add, edit, delete, and reorder questions with **Move Up / Move Down** controls.
- **2 to 4 answer options** per question, auto-labeled A, B, C, D.
- **Interactive Live Mobile Preview**: Real-time smartphone mockup showing how the question looks to parents.
- **Auto-save drafts** to prevent data loss.
- **Parent Privacy / Year Visibility Toggle**: Option to show or hide the student's cohort on their mobile screen.
- **"Finish & Start Meeting"**: Enforces at least 1 valid question with at least 2 options before starting.

### 2. Stage 2: HOD Projector & Admin Dashboard
- High-contrast, presentation-ready dark theme designed for auditorium projectors.
- **Live-updating animated bar chart** with vote counts and percentages.
- **Year-group filter pills** (*All Years*, *1st Year*, *2nd Year*, *3rd Year*, *Final Year*) for instant cohort feedback comparison.
- Full control bar: Launch Poll, Close Poll & Lock Results, Next/Previous, Reset.
- **Mid-Meeting "Edit Questions"**: Tweak upcoming questions mid-meeting without disrupting already-answered ones.
- **Projector QR Code overlay** with automatic local Wi-Fi IP detection.

### 3. Parent Mobile Portal
- **Zero Login Friction**: Parents scan a QR code and select their student's year-group.
- **Tactile Option Cards**: One-tap voting with immediate haptic and visual confirmation.
- **Dynamic Waiting Screen**: Subtle radar animation while awaiting the next question.
- **Automatic Reconnection**: Recovers seamlessly if the phone screen locks or Wi-Fi drops.

### 4. Records & Export
- **CSV Export**: One-click download containing full breakdowns per option and year-group.
- **Printable Executive Summary**: Formatted report with built-in PDF print support.

---

## 🚀 Quick Start

### 1. Installation
```bash
git clone https://github.com/suchithrasaravanan05-afk/pollpoint.git
cd pollpoint
npm install
```

### 2. Run the App
```bash
npm start
```
The server will output:
```
====================================================
  PTM Live Polling Web App Started Successfully!   
====================================================
  Local Admin URL:    http://localhost:3001/admin.html
  Venue Wi-Fi Parent Join URL: http://<YOUR_IP>:3001
====================================================
```

### 3. Open in Browser
- **HOD Meeting Setup & Dashboard**: `http://localhost:3001/admin.html`
- **Parent Mobile Portal**: `http://localhost:3001/` (or scan the projected QR code)

---

## 🛠️ Tech Stack
- **Backend**: Node.js, Express, Socket.IO, QRCode
- **Frontend**: Vanilla HTML5, CSS3, Modern JavaScript (ES6+)
- **Design System**: Plus Jakarta Sans, Dark theme with high-contrast accessibility
