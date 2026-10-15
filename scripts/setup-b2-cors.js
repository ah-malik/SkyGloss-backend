/**
 * One-time Backblaze B2 bucket setup for the admin media library.
 * Lets the admin panel upload files directly from the browser to B2.
 *
 * Usage: node scripts/setup-b2-cors.js <origin> [<origin> ...]
 *   e.g. node scripts/setup-b2-cors.js https://admin.skygloss.com http://localhost:5173
 *
 * Needs B2_KEY_ID / B2_APPLICATION_KEY / B2_BUCKET_NAME in .env and a key with
 * the writeBuckets capability (run it once with an account-level key).
 */
require('dotenv').config();
const axios = require('axios');

async function main() {
  const origins = process.argv.slice(2);
  if (!origins.length) {
    console.error('Pass at least one allowed origin, e.g. https://admin.skygloss.com');
    process.exit(1);
  }
  const { B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME } = process.env;
  const auth = await axios.get('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
    auth: { username: B2_KEY_ID, password: B2_APPLICATION_KEY },
  });
  const { apiUrl } = auth.data.apiInfo.storageApi;
  const headers = { Authorization: auth.data.authorizationToken };

  const list = await axios.post(
    `${apiUrl}/b2api/v3/b2_list_buckets`,
    { accountId: auth.data.accountId, bucketName: B2_BUCKET_NAME },
    { headers },
  );
  const bucket = list.data.buckets[0];
  if (!bucket) throw new Error(`Bucket ${B2_BUCKET_NAME} not found`);

  const corsRules = [
    {
      corsRuleName: 'adminMediaLibrary',
      allowedOrigins: origins,
      allowedOperations: ['b2_upload_file', 'b2_upload_part', 'b2_download_file_by_name'],
      allowedHeaders: [
        'authorization',
        'content-type',
        'x-bz-file-name',
        'x-bz-content-sha1',
        'x-bz-part-number',
        'x-bz-info-*',
      ],
      exposeHeaders: ['x-bz-content-sha1'],
      maxAgeSeconds: 3600,
    },
  ];
  // Keep any CORS rules that are not ours.
  const otherRules = (bucket.corsRules || []).filter((r) => r.corsRuleName !== 'adminMediaLibrary');

  await axios.post(
    `${apiUrl}/b2api/v3/b2_update_bucket`,
    { accountId: auth.data.accountId, bucketId: bucket.bucketId, corsRules: [...otherRules, ...corsRules] },
    { headers },
  );
  console.log(`CORS updated on ${bucket.bucketName} for: ${origins.join(', ')}`);
}

main().catch((err) => {
  console.error('Failed:', err.response?.data || err.message);
  process.exit(1);
});
