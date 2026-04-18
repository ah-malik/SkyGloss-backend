const axios = require('axios');

// NEW Google Apps Script URL
const webappUrl = 'https://script.google.com/macros/s/AKfycbzkp7ZcKynIad4V4Juj9YDplfcJUPwjmbI9lijYzfOqemYoixN427hYVft1Pg27CijpIA/exec';

const payload = {
    requesterName: "CLEAN TEST",
    distributorName: "NO PENDING",
    shopName: "FINAL TEST SHOP",
    shopEmail: "clean@test.com",
    shopPhone: "+1-555-CLEAN",
    country: "USA",
    streetAddress: "123 Clean Street",
    city: "Test City",
    state: "TX",
    zip: "77777",
    instagram: "@cleantest",
    facebook: "Clean Test",
    website: "www.cleantest.com"
};

async function test() {
    try {
        console.log('Attempting POST to NEW Google Web App...');
        console.log('URL:', webappUrl);
        console.log('Payload:', JSON.stringify(payload, null, 2));
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
