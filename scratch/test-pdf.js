const PDFDocument = require('pdfkit');
const fs = require('fs');

try {
    const doc = new PDFDocument();
    doc.pipe(fs.createWriteStream('test.pdf'));
    doc.text('Hello PDF');
    doc.end();
    console.log('PDF generated successfully');
} catch (err) {
    console.error('PDF generation failed:', err);
}
