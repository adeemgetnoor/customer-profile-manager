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

// Enhanced CORS for Vercel deployment
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Allow your Shopify store and common development origins
    const allowedOrigins = [
      `https://${SHOP_NAME}`,
      `https://${SHOP_NAME.replace('.myshopify.com', '')}.myshopify.com`,
      'http://localhost:3000',
      'http://127.0.0.1:3000'
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('.myshopify.com')) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all origins for now, restrict later if needed
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ============================================
// ROOT ENDPOINT - Welcome Message
// ============================================
app.get('/', (req, res) => {
  res.json({ 
    success: true,
    status: 'ok', 
    message: 'Shopify Customer Profile App API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    shop: SHOP_NAME,
    endpoints: {
      root: '/ (GET) - This message',
      health: '/health (GET) - Health check',
      updateProfile: '/update-profile (POST) - Update customer metafields',
      getProfile: '/get-profile?customer_id=xxx (GET) - Get customer profile',
      uploadImage: '/upload-profile-image (POST) - Upload profile image'
    }
  });
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

    console.log('📝 Received update request:', { customer_id, alternate_phone, gender, date_of_birth });

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

    console.log('🚀 Sending GraphQL mutation to Shopify...');

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

    console.log('✅ GraphQL response received');

    const errors = response.data.data?.customerUpdate?.userErrors;
    if (errors && errors.length > 0) {
      console.error('❌ Shopify errors:', errors);
      return res.status(400).json({ success: false, error: errors });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      customer: response.data.data.customerUpdate.customer
    });
  } catch (err) {
    console.error('❌ ERROR updating profile:', err.response?.data || err.message);
    res.status(500).json({ 
      success: false, 
      error: err.response?.data?.errors || err.message 
    });
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
  console.log(`✅ CORS enabled for Shopify store`);
});

// Export for Vercel
module.exports = app;