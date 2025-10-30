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
app.use(express.json({ limit: '10mb' })); // Increase limit for base64 images
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
// ENDPOINT 4: Upload Profile Image (File Type)
// ============================================
app.post('/upload-profile-image', async (req, res) => {
  try {
    const { customer_id, image_url } = req.body;

    console.log('📸 Received image upload request');
    console.log('👤 Customer ID:', customer_id);
    console.log('📏 Image data length:', image_url?.length);

    if (!customer_id || !image_url) {
      return res.status(400).json({ success: false, error: 'Customer ID and image URL required' });
    }

    // Step 1: Convert base64 to buffer
    const base64Data = image_url.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    console.log('📦 Image buffer size:', buffer.length, 'bytes');

    // Step 2: Create staged upload
    const stagedUploadMutation = `
      mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const stagedUploadVariables = {
      input: [
        {
          resource: "IMAGE",
          filename: `customer_${customer_id}_profile.jpg`,
          mimeType: "image/jpeg",
          httpMethod: "POST"
        }
      ]
    };

    console.log('🚀 Step 1: Creating staged upload...');

    const stagedUploadResponse = await axios.post(
      `https://${SHOP_NAME}/admin/api/${API_VERSION}/graphql.json`,
      { query: stagedUploadMutation, variables: stagedUploadVariables },
      {
        headers: {
          'X-Shopify-Access-Token': ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('📥 Staged upload response:', JSON.stringify(stagedUploadResponse.data, null, 2));

    const stagedTarget = stagedUploadResponse.data.data?.stagedUploadsCreate?.stagedTargets?.[0];
    const stagedErrors = stagedUploadResponse.data.data?.stagedUploadsCreate?.userErrors;

    if (stagedErrors && stagedErrors.length > 0) {
      console.error('❌ Staged upload errors:', stagedErrors);
      return res.status(400).json({ success: false, error: stagedErrors });
    }

    if (!stagedTarget) {
      console.error('❌ No staged target returned');
      return res.status(400).json({ success: false, error: 'Failed to create staged upload' });
    }

    // Step 3: Upload file to staged URL
    console.log('🚀 Step 2: Uploading file to:', stagedTarget.url);

    const FormData = require('form-data');
    const formData = new FormData();

    // Add parameters from staged upload
    stagedTarget.parameters.forEach(param => {
      formData.append(param.name, param.value);
    });

    // Add the file
    formData.append('file', buffer, {
      filename: `customer_${customer_id}_profile.jpg`,
      contentType: 'image/jpeg'
    });

    const uploadResponse = await axios.post(stagedTarget.url, formData, {
      headers: {
        ...formData.getHeaders()
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    console.log('✅ File uploaded successfully');
    console.log('📍 Resource URL:', stagedTarget.resourceUrl);

    // Step 4: Create file in Shopify
    const fileCreateMutation = `
      mutation fileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            ... on MediaImage {
              id
              image {
                url
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

    const fileCreateVariables = {
      files: [
        {
          alt: `Profile image for customer ${customer_id}`,
          contentType: "IMAGE",
          originalSource: stagedTarget.resourceUrl
        }
      ]
    };

    console.log('🚀 Step 3: Creating file in Shopify...');

    const fileCreateResponse = await axios.post(
      `https://${SHOP_NAME}/admin/api/${API_VERSION}/graphql.json`,
      { query: fileCreateMutation, variables: fileCreateVariables },
      {
        headers: {
          'X-Shopify-Access-Token': ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('📥 File create response:', JSON.stringify(fileCreateResponse.data, null, 2));

    const fileErrors = fileCreateResponse.data.data?.fileCreate?.userErrors;
    if (fileErrors && fileErrors.length > 0) {
      console.error('❌ File create errors:', fileErrors);
      return res.status(400).json({ success: false, error: fileErrors });
    }

    const fileId = fileCreateResponse.data.data?.fileCreate?.files?.[0]?.id;
    if (!fileId) {
      console.error('❌ No file ID returned');
      return res.status(400).json({ success: false, error: 'Failed to create file' });
    }

    console.log('✅ File created with ID:', fileId);

    // Step 5: Update customer metafield with file reference
    const updateMetafieldMutation = `
      mutation updateCustomerImage($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer {
            id
            metafields(first: 10, namespace: "custom") {
              edges {
                node {
                  key
                  value
                  reference {
                    ... on MediaImage {
                      image {
                        url
                      }
                    }
                  }
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

    const updateMetafieldVariables = {
      input: {
        id: `gid://shopify/Customer/${customer_id}`,
        metafields: [
          {
            namespace: 'custom',
            key: 'profile_image',
            value: fileId,
            type: 'file_reference'
          }
        ]
      }
    };

    console.log('🚀 Step 4: Updating customer metafield...');

    const metafieldResponse = await axios.post(
      `https://${SHOP_NAME}/admin/api/${API_VERSION}/graphql.json`,
      { query: updateMetafieldMutation, variables: updateMetafieldVariables },
      {
        headers: {
          'X-Shopify-Access-Token': ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('📥 Metafield update response:', JSON.stringify(metafieldResponse.data, null, 2));

    const metafieldErrors = metafieldResponse.data.data?.customerUpdate?.userErrors;
    if (metafieldErrors && metafieldErrors.length > 0) {
      console.error('❌ Metafield update errors:', metafieldErrors);
      return res.status(400).json({ success: false, error: metafieldErrors });
    }

    console.log('✅ Profile image uploaded and linked successfully!');

    res.json({ 
      success: true, 
      message: 'Profile image updated successfully',
      fileId: fileId,
      customer: metafieldResponse.data.data?.customerUpdate?.customer
    });

  } catch (err) {
    console.error('❌ ERROR uploading image:', err.response?.data || err.message);
    console.error('❌ Error stack:', err.stack);
    res.status(500).json({ 
      success: false, 
      error: err.response?.data?.errors || err.message 
    });
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