# Snail PDF

Snail PDF is a browser-based PDF editor and reader built with React, Vite, PDF.js, and PDF-lib. It lets you open a PDF, review pages, add notes, highlight content, draw markup, undo changes, print the result, and save a clean edited PDF.

## Features

- Open and render a PDF directly in the browser
- Navigate through multiple pages
- Zoom in and out for cleaner reading
- Add text annotations on any page
- Highlight sections of a page
- Draw freehand markup directly on the PDF preview
- Undo and redo edits in a working history
- Delete selected markup if needed
- Print the edited result
- Save the updated document as a new PDF file

## Live project

Repository: https://github.com/nibertinvestments/Snail-PDF

## Run locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development server:
   ```bash
   npm run dev
   ```
3. Open the local URL shown in the terminal (typically http://localhost:3000)

## Production build

```bash
npm run build
```

## Tech stack

- React
- Vite
- PDF.js
- PDF-lib

## Notes

This project is designed to behave like a lightweight PDF editing tool in the browser, with robust rendering and export support for edited files. The app stores editing actions in an undo/redo history so changes can be reviewed and reversed before saving or printing.
