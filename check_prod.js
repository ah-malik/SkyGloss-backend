const axios = require('axios');

async function checkProd() {
  try {
    const res = await axios.get('https://skygloss-backend-production-3b96.up.railway.app/public/map-locations');
    console.log('Prod Locations:', res.data.data ? res.data.data.length : 'Error');
  } catch (err) {
    console.error('Prod Error:', err.message);
  }
}

checkProd();
