/**
 * Local preview of the partner certificate PDF (Assets → Your certificate).
 *   npx ts-node --transpile-only scratch/test-partner-certificate.ts [out.pdf]
 */
import * as fs from 'fs';
import * as path from 'path';
import { PdfService } from '../src/pdf/pdf.service';

async function main() {
  const out = process.argv[2] || path.join(__dirname, 'partner-certificate-preview.pdf');
  const service = new PdfService();
  const samples = [
    {
      role: 'distributor',
      firstName: 'Omar',
      lastName: 'Khan',
      companyName: 'Northline Distribution',
      country: 'Pakistan',
      partnerCode: 'SG10021',
      accountActivatedAt: new Date('2026-10-23T12:00:00Z'),
    },
    {
      role: 'regional_partner',
      firstName: 'Sara',
      lastName: 'Malik',
      country: 'Pakistan',
      partnerCode: 'SG10482',
      accountActivatedAt: new Date('2026-10-23T12:00:00Z'),
    },
    {
      role: 'master_partner',
      firstName: 'Daniel',
      lastName: 'Reyes',
      state: 'Arizona',
      country: 'United States',
      partnerCode: 'SG10317',
      accountActivatedAt: new Date('2026-10-23T12:00:00Z'),
    },
  ];
  const which = Number(process.argv[3] || 0);
  const data = service.getPartnerCertificateData(samples[which]);
  const buffer = await service.generatePartnerCertificate(data);
  fs.writeFileSync(out, buffer);
  console.log('wrote', out, buffer.length, 'bytes', data);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
