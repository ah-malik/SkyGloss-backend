/**
 * Links items in the portal Assets library (/assets2) to files in the admin
 * Media Library, by the file name they were uploaded with.
 *
 * Key: asset id from public/assets2.html (e.g. "tesla-ff").
 * Value: index of the item's download row -> uploaded file name.
 *
 * If several uploads share a name, the newest one is used, so uploading a file
 * with the same name again replaces what partners download.
 * Only files listed here are exposed to portal users.
 */
export const ASSET_FILE_LINKS: Record<string, Record<number, string>> = {
  // Factory Forever: Tesla appearance maintenance program -> "For presenting"
  'tesla-ff': {
    0: 'Copy of FACTORY FOREVER - Tesla Appearance Maintenance Program.pdf',
  },
  // SkyGloss presentation for shop owners -> "For presenting"
  'owner-pres': {
    0: 'Copy of Get SkyGloss Certified.pdf',
  },
  // SkyGloss Global Master Distributor presentation -> "For presenting"
  'gmd-pres': {
    0: 'SkyGloss Global Master Distributor Presentation.pdf',
  },
  // Paint Health Check form -> "Print or fill in on screen"
  'phc-form': {
    0: 'SkyGloss Paint Health Check Form.pdf',
  },
  // FUSION service booklet -> "For sharing", "For printing" (one PDF for both)
  'bk-fusion': {
    0: 'FUSION BOOKLET.pdf',
    1: 'FUSION BOOKLET.pdf',
  },
  // RESIN FILM service booklet -> "For sharing", "For printing"
  'bk-resin': {
    0: 'RESIN BOOKLET.pdf',
    1: 'RESIN BOOKLET.pdf',
  },
  // SHIELD service booklet -> "For sharing", "For printing"
  'bk-shield': {
    0: 'SHIELD Booklet.pdf',
    1: 'SHIELD Booklet.pdf',
  },
  // Care sheet for car owners -> "For printing", "For sharing"
  care: {
    0: 'SkyGloss Care Instructions.pdf',
    1: 'SkyGloss Care Instructions.pdf',
  },
  // Product catalogue 2026 -> "For sharing"
  catalogue: {
    0: '2026 SkyGloss Catalog_Presentation.pdf',
  },
  // Sales philosophy cheat sheet -> "For reading"
  'sales-cheat': {
    0: 'SkyGloss Sales Philosophy Cheat Sheet.pdf',
  },
  // SkyGloss Brand Book -> "For reading"
  'brand-book': {
    0: 'Copy of SkyGloss Brand Book.pdf',
  },
  // Brand Guidelines -> "For reading"
  'brand-guide': {
    0: 'Copy of SkyGloss Brand Guidelines.pdf',
  },
  // Factory Forever signature -> "Blue", "White"
  'ff-sig': {
    0: 'skygloss-factory-forever-blue-rgb.svg',
    1: 'skygloss-factory-forever-white-rgb.svg',
  },
  // Application footage, black SUV -> "1080p"
  footage: {
    0: 'VIDEO-2025-05-13-21-52-54.mp4',
  },
  // Gift certificate -> "Print or fill in on screen"
  gift: {
    0: 'SkyGloss Gift Certificate.pdf',
  },
  // Run my shop (Shop forms & checklists) -> "Print or fill in on screen"
  // Customer forms
  estimate: {
    0: 'SkyGloss Estimate Form.pdf',
  },
  intake: {
    0: 'SkyGloss Intake Form.pdf',
  },
  'shield-warranty': {
    0: 'SkyGloss Shield Warranty Form.pdf',
  },
  // Shop forms (Daily sales: PDF row only, no spreadsheet uploaded yet)
  redo: {
    0: 'SkyGloss Redo Form.pdf',
  },
  daily: {
    0: 'SkyGloss Daily Sales Form.pdf',
  },
  quarterly: {
    0: 'SkyGloss Quarterly Report.pdf',
  },
  // Checklists (Inventory: PDF row only, no spreadsheet uploaded yet)
  inventory: {
    0: 'SkyGloss Inventory Checklist.pdf',
  },
  'shop-items': {
    0: 'SkyGloss Shop Items.pdf',
  },
  // Price sheets
  'price-sheet': {
    0: 'SkyGloss Pricing Sheet.pdf',
  },
  'price-na': {
    0: 'Standard Service Pricing (North America).pdf',
  },
  // Use a product -> step-by-step instructions ("For printing")
  'sbs-fusion': {
    0: '1 SBS Instruction - Fusion.pdf',
  },
  'sbs-resin-film': {
    0: '2 SBS Instruction - Resin Film.pdf',
  },
  'sbs-seal': {
    0: '3 SBS Instruction - Seal.pdf',
  },
  'sbs-matte': {
    0: '4 SBS Instruction - Matte.pdf',
  },
  'sbs-shine': {
    0: '5 SBS Instruction - Shine.pdf',
  },
  // Use a product -> technical data sheets ("For reading")
  'tds-fusion': {
    0: '01 Technical Data Sheets (TDS) - FUSION.pdf',
  },
  'tds-resin-film': {
    0: '02 Technical Data Sheets (TDS) - RESIN FILM.pdf',
  },
  'tds-shine': {
    0: '03 Technical Data Sheets (TDS) - SHINE.pdf',
  },
  'tds-matte': {
    0: '04 Technical Data Sheets (TDS) - MATTE.pdf',
  },
  'tds-seal': {
    0: '05 Technical Data Sheets (TDS) - SEAL.pdf',
  },
  // Promote my shop -> Social media: one card per file.
  'sm-header': {
    0: 'SkyGloss Social Media Header.png',
  },
  'sm-launch': {
    0: 'Launch Post.jpg',
  },
  // Linked by storage path because several uploads share a name (1.mp4, 2.mp4, ...).
  'sm-video-1': {
    0: 'media/videos/2026/10/9b7abf90-d093-4abd-8a7c-795a3b81bf60-1.mov',
  },
  'sm-video-2': {
    0: 'media/videos/2026/10/348eddcc-1d79-40de-9e7f-e214a9dc8767-1-1.mp4',
  },
  'sm-video-3': {
    0: 'media/videos/2026/10/5c14a4ff-0c4f-47d4-a50f-18f5d298ece5-2.mp4',
  },
  'sm-video-4': {
    0: 'media/videos/2026/10/7c79e9e7-e908-4f38-8434-ad231f0c263d-1.mp4',
  },
  'sm-video-5': {
    0: 'media/videos/2026/10/63c97a3a-5405-4f57-b71b-1ed5689e02e9-3.mp4',
  },
  'sm-video-6': {
    0: 'media/videos/2026/10/684d5dfc-c01e-4fe4-8f88-9e556528b3a9-1.mp4',
  },
  'sm-video-7': {
    0: 'media/videos/2026/10/7c153b38-7257-42a8-b117-a3f0774b90e2-2.mp4',
  },
  'sm-video-8': {
    0: 'media/videos/2026/10/14ce298a-9c57-4b6a-884c-30ef2b38c375-3.mp4',
  },
  'sm-video-9': {
    0: 'media/videos/2026/10/3e75907d-b270-4c6f-87eb-9ce9a1da05b1-2.mp4',
  },
  'sm-photo-1': {
    0: 'media/images/2026/10/70097024-707d-4f2e-a7ad-719e22b71d71-4.jpg',
  },
  'sm-photo-2': {
    0: 'media/images/2026/10/b935388e-d3c3-488b-acee-9add2682efb6-1.jpg',
  },
  'sm-photo-3': {
    0: 'media/images/2026/10/c67829da-6c53-4bea-8e90-085a73553611-4.jpg',
  },
};

/**
 * Same idea for items with an "In this pack" list (e.g. the logo set):
 * pack row index -> uploaded file names, one download button per file.
 */
export const ASSET_PACK_LINKS: Record<string, Record<number, string[]>> = {
  'logo-set': {
    // Logo on black
    0: [
      'skygloss-wordmark-black-rgb.svg',
      'skygloss-wordmark-black-rgb-900px-w-72ppi.png',
      'skygloss-wordmark-black-cmyk.pdf',
    ],
    // Logo on sky blue
    1: [
      'skygloss-wordmark-blue-rgb.svg',
      'skygloss-wordmark-blue-rgb-900px-w-72ppi.png',
      'skygloss-wordmark-blue-cmyk.pdf',
    ],
    // Logo on white
    2: [
      'skygloss-wordmark-white-rgb.svg',
      'skygloss-wordmark-white-rgb-900px-w-72ppi.png',
      'skygloss-wordmark-white-cmyk.pdf',
    ],
  },
};
