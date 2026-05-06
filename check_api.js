const axios = require('axios');

async function checkPublicApi() {
  try {
    const res = await axios.get('http://localhost:3001/public/map-locations');
    const locations = res.data.data; // Access data.data
    console.log('Locations found:', locations ? locations.length : 'N/A');
    if (locations && locations.length > 0) {
      console.log('Sample location:', locations[0]);
      console.log('Countries:', [...new Set(locations.map(l => l.country))]);
    } else {
      console.log('No locations returned in data.data');
      console.log('Full response body:', JSON.stringify(res.data, null, 2));
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

checkPublicApi();
