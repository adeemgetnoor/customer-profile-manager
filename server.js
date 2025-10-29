// server.js - Shopify Customer Profile App Backend (No App Proxy)

const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();

// ============================================
// CONFIGURATION
// ============================================
const SHOP_NAME = process.env.SHOP_NAME;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const API_VERSION = process.env.API_VERSION || '2024-10';
const PORT = process.env.PORT || 3000;

// Validate environment variables
if (!SHOP_NAME || !ACCESS_TOKEN) {
  console.error('❌ ERROR: Missing required environment variables!');
  console.error('Please check your .env file and ensure these are set:');
  console.error('  - SHOP_NAME');
  console.error('  - ACCESS_TOKEN');
  process.exit(1);
}

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ============================================
// ENDPOINT 1: Health Check
// ============================================
app.get('/health', (req, res) => {
  res.json({ 
    success: true,
    status: 'ok', 
    message: 'Shopify Customer Profile App is running',
    timestamp: new Date().toISOString(),
    shop: SHOP_NAME
  });
});

// ============================================
// ENDPOINT 2: Update Customer Profile (Metafields)
// ============================================
app.post('/update-profile', async (req, res) => {
  try {
    const { customer_id, alternate_phone, gender, date_of_birth } = req.body;

    if (!customer_id) {
      return res.status(400).json({ success: false, error: 'Customer ID is required' });
    }

    const metafields = [];

    if (alternate_phone) {
      metafields.push({
        namespace: 'custom',
        key: 'alternate_phone',
        value: alternate_phone,
        type: 'single_line_text_field'
      });
    }

    if (gender) {
      metafields.push({
        namespace: 'custom',
        key: 'gender',
        value: gender,
        type: 'single_line_text_field'
      });
    }

    if (date_of_birth) {
      metafields.push({
        namespace: 'custom',
        key: 'date_of_birth',
        value: date_of_birth,
        type: 'date'
      });
    }

    if (metafields.length === 0) {
      return res.json({ success: true, message: 'No metafields to update' });
    }

    const mutation = `
      mutation updateCustomerMetafields($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer {
            id
            firstName
            lastName
            email
            metafields(first: 10, namespace: "custom") {
              edges {
                node {
                  key
                  value
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        id: `gid://shopify/Customer/${customer_id}`,
        metafields
      }
    };

    const response = await axios.post(
      `https://${SHOP_NAME}/admin/api/${API_VERSION}/graphql.json`,
      { query: mutation, variables },
      {
        headers: {
          'X-Shopify-Access-Token': ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    const errors = response.data.data.customerUpdate.userErrors;
    if (errors && errors.length > 0) {
      return res.status(400).json({ success: false, error: errors });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      customer: response.data.data.customerUpdate.customer
    });
  } catch (err) {
    console.error('❌ ERROR updating profile:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// ENDPOINT 3: Get Customer Profile
// ============================================
app.get('/get-profile', async (req, res) => {
  try {
    const { customer_id } = req.query;

    if (!customer_id) {
      return res.status(400).json({ success: false, error: 'Customer ID is required' });
    }

    const query = `
      query getCustomer($id: ID!) {
        customer(id: $id) {
          id
          firstName
          lastName
          email
          phone
          metafields(first: 10, namespace: "custom") {
            edges {
              node {
                key
                value
              }
            }
          }
        }
      }
    `;

    const variables = { id: `gid://shopify/Customer/${customer_id}` };

    const response = await axios.post(
      `https://${SHOP_NAME}/admin/api/${API_VERSION}/graphql.json`,
      { query, variables },
      {
        headers: {
          'X-Shopify-Access-Token': ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({ success: true, customer: response.data.data.customer });
  } catch (err) {
    console.error('❌ ERROR fetching profile:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// ENDPOINT 4: Upload Profile Image
// ============================================
app.post('/upload-profile-image', async (req, res) => {
  try {
    const { customer_id, image_url } = req.body;

    if (!customer_id || !image_url) {
      return res.status(400).json({ success: false, error: 'Customer ID and image URL required' });
    }

    const mutation = `
      mutation updateCustomerImage($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer {
            id
            metafields(first: 10, namespace: "custom") {
              edges {
                node {
                  key
                  value
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        id: `gid://shopify/Customer/${customer_id}`,
        metafields: [
          {
            namespace: 'custom',
            key: 'profile_image',
            value: image_url,
            type: 'single_line_text_field'
          }
        ]
      }
    };

    const response = await axios.post(
      `https://${SHOP_NAME}/admin/api/${API_VERSION}/graphql.json`,
      { query: mutation, variables },
      {
        headers: {
          'X-Shopify-Access-Token': ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    const userErrors = response.data.data.customerUpdate.userErrors;
    if (userErrors && userErrors.length > 0) {
      return res.status(400).json({ success: false, error: userErrors });
    }

    res.json({ success: true, message: 'Profile image updated successfully' });
  } catch (err) {
    console.error('❌ ERROR uploading image:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// Start Server
// ============================================
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🏪 Connected to Shopify store: ${SHOP_NAME}`);
});
