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
      role: 'master_partner',
      firstName: 'Alex',
      lastName: 'Morgan',
      country: 'United States',
      partnerCode: 'SG-REP-10482',
      accountActivatedAt: new Date('2025-05-27T12:00:00Z'),
    },
    {
      role: 'distributor',
      firstName: 'Maria',
      lastName: 'Fernandez',
      companyName: 'Fernandez Automotive Distribution GmbH',
      country: 'Germany',
      accountActivatedAt: new Date('2026-10-21T12:00:00Z'),
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
