# MetaWipe

A premium, browser-based metadata removal tool with deep structural byte-level sanitization and a professional neumorphic UI.

![MetaWipe](https://img.shields.io/badge/Privacy-100%25%20Local-blue)
![Browser-Based](https://img.shields.io/badge/No%20Upload-Required-green)
![License](https://img.shields.io/badge/License-MIT-yellow)

## Overview

MetaWipe is a comprehensive metadata removal application that runs entirely in your browser. It implements advanced binary-level sanitization techniques to thoroughly strip EXIF, IPTC, XMP, GPS, and other metadata from images, PDFs, and Office documents without uploading files to any server.

## Features

### Core Functionality
- **Deep Structural Stripping**: Binary segment-slicing for JPEGs, chunk parsing for PNG/WebP, stream nullification for PDFs, and container scrubbing for DOCX files
- **Accurate Telemetry**: Pre-scan and post-scan tag counting with precise KB savings calculation
- **Batch Processing**: Process multiple files simultaneously with ZIP download option
- **Format Conversion**: Convert images to JPG/WebP/PNG during cleaning
- **Selective Mode**: Granular field-by-field metadata selection
- **Nuclear Wipe**: One-click master switch to enable all removal options

### Supported File Types
- **Images**: JPEG, PNG, WebP, TIFF
- **Documents**: PDF, DOCX
- **Metadata Types**: EXIF, IPTC, XMP, GPS, File Info

### Privacy & Security
- **100% Browser-Based**: All processing happens locally in your browser
- **No Server Uploads**: Your files never leave your device
- **No Data Persistence**: Session-only logging, no stored data
- **Open Source**: Fully auditable codebase

### UI/UX
- **Professional Neumorphic Design**: Light and dark theme support
- **Theme Persistence**: User preferences saved in localStorage
- **Liquid Gauge Animation**: Smooth progress indicator during processing
- **Physics-Based Interactions**: Dropzone transitions from inset to extruded on drag
- **Tactile Audio Feedback**: Web Audio API generates mechanical click sounds
- **Responsive Design**: Mobile-optimized with expanded tap targets
- **Session Log**: Timestamped history of all cleaning operations

## Technologies

- **React 18** with TypeScript
- **Vite** for fast development and building
- **pdf-lib** for PDF metadata manipulation
- **JSZip** for DOCX file processing
- **exifr** for image metadata extraction
- **Leaflet** for GPS map visualization
- **Web Audio API** for tactile feedback sounds
- **Tailwind CSS** for styling

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd metawipe

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Usage

1. **Upload Files**: Drag & drop or click to select multiple files (images, PDFs, DOCX)
2. **Configure Options**: 
   - Toggle specific metadata types (EXIF, IPTC, XMP, GPS, Trailing Data)
   - Use "Nuclear Wipe" to enable all options at once
   - Enable "Selective Mode" for granular field selection
3. **Choose Output Format**: Select Original, JPG, WebP, or PNG for images
4. **Clean & Download**: Process files and download cleaned versions
5. **View Session Log**: Check timestamped history with accurate tag counts and KB saved

### Metadata Overview
The interface displays "Total Tags Found: X | Tags Purged: Y" above the metadata table, providing real-time feedback on the cleaning process.

## Technical Implementation

### Deep Stripping Engine

#### JPEG Processing
- Binary segment-slicing removes entire APP1 (0xFFE1) and APP13 (0xFFED) blocks
- Detects EXIF ("Exif\x00\x00"), XMP ("http://ns.adobe.com/xap/1.0/"), and IPTC ("Photoshop 3.0\x00") headers
- Counts IFD entries, XMP XML tags, and IPTC records for accurate telemetry
- Truncates trailing data after EOI marker (0xFFD9)

#### PNG Processing
- Chunk-level parsing strips eXIf, tEXt, iTXt, zTXt metadata chunks
- Preserves IHDR, IDAT, and IEND chunks for file integrity

#### WebP Processing
- RIFF container parsing removes EXIF and XMP chunks
- Recalculates container size after removal

#### PDF Processing
- Uses pdf-lib to remove standard metadata fields
- Binary scanning removes XMP packet markers (`<?xpacket begin/end`)
- Deletes `/Metadata` and `/PieceInfo` objects from catalog

#### DOCX Processing
- JSZip unzips the DOCX container
- Scrubs `docProps/core.xml` (creator, title, lastModifiedBy, created, modified)
- Cleans `docProps/app.xml` (application, appVersion, company, template)
- Removes `docProps/custom.xml` and `docProps/thumbnail.jpeg` entirely
- Re-zips and generates clean DOCX file

### Telemetry System
- **Pre-scan Loop**: Counts all metadata tags before processing
- **Post-scan Loop**: Counts remaining tags after cleaning
- **Accurate Calculation**: `tagsRemoved = preCount - postCount`
- **File Size Comparison**: `savedKB = (originalSize - cleanedSize) / 1024`

### Theme System
- **Light Theme**: #eef2f7 base, white highlights, #cbd5e1 shadows
- **Dark Theme**: #23272a base (Cyber Slate), #2c3135 highlights, #1a1c1e shadows, #8b5cf6 accent
- **Persistence**: localStorage key `metawipe-dark-mode`

## Browser Compatibility

- ✅ Chrome/Edge (Full support)
- ✅ Firefox (Full support)
- ✅ Safari (Full support)
- ✅ Mobile browsers (Responsive design with touch optimization)

## Project Structure

```
src/
├── App.tsx                    # Main component with theme support
├── index.css                  # Dual-theme neumorphic design system
├── main.tsx                   # Application entry point
└── utils/
    ├── metadataReader.ts      # EXIF/IPTC/XMP extraction
    ├── metadataRemover.ts     # Deep byte-level sanitization engine
    ├── formatConverter.ts     # Image format conversion
    └── audioFeedback.ts       # Web Audio API sound generation
```

## Privacy Statement

MetaWipe is designed with privacy as the core principle:
- All file processing occurs locally in your browser
- No files are uploaded to any server
- No data is stored or transmitted
- The application works offline after initial load
- All code is open source and auditable

## Development

```bash
# Run development server with hot reload
npm run dev

# Type checking
npm run type-check

# Linting
npm run lint

# Build for production
npm run build

# Preview production build
npm run preview
```

## License

MIT License - feel free to use this project for personal or commercial purposes.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

- Inspired by exifremover.com's deep cleaning approach
- Built with modern web technologies for maximum privacy and performance
- Neumorphic design system for premium user experience
