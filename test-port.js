const axios = require('axios');

const webappUrl = 'https://script.google.com/macros/s/AKfycbyS5hJD8kn_pq6qKlnBynwBODvJ-3DIbVOefKm8ZPCVRYe9sn1xSa4CKsbhB1Fc40y1Zw/exec';

const payload = {
    requesterName: "ANTIGRAVITY TESTER",
    distributorName: "GLOBAL DISTRIBUTOR",
    shopName: "SKYGLOSS ELITE SHOP",
    shopEmail: "test@skygloss.com",
    shopPhone: "+1 (555) 000-TEST",
    country: "USA",
    streetAddress: "789 Master Way",
    city: "New York",
    state: "NY",
    zip: "10001",
    instagram: "@skygloss_test",
    facebook: "SkyGloss Official",
    website: "www.skygloss-test.com",
    certificateNumber: "SG-CERT-2026-FINAL-VERIFY"
};

async function test() {
    try {
        console.log('Attempting POST to Google Web App...');
        const response = await axios.post(webappUrl, payload, {
            headers: { 'Content-Type': 'application/json' },
            maxRedirects: 10
        });
        console.log('Status:', response.status);
        console.log('Data:', JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Data:', error.response.data);
            console.error('Status:', error.response.status);
        }
    }
}

test();
