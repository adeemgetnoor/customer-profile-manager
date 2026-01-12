// server.js - Shopify Customer Profile App Backend (No App Proxy)

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const FormData = require('form-data');
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
      uploadImage: '/upload-profile-image (POST) - Upload profile image',
      getWishlist: '/wishlist?customer_id=xxx (GET) - Get wishlist items',
      addWishlist: '/wishlist/add (POST) - Add product to wishlist { customer_id, product_id }',
      removeWishlist: '/wishlist/remove (POST) - Remove product from wishlist { customer_id, product_id }'
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
// ENDPOINT 2: Update Customer (All Fields Including Native + Metafields)
// ============================================
app.post('/update-customer', async (req, res) => {
  try {
    const { customer_id, first_name, last_name, email, phone, alternate_phone, gender, date_of_birth } = req.body;

    console.log('📝 Received full customer update request:', { 
      customer_id, first_name, last_name, email, phone, alternate_phone, gender, date_of_birth 
    });

    if (!customer_id) {
      return res.status(400).json({ success: false, error: 'Customer ID is required' });
    }

    // Prepare the update input
    const updateInput = {
      id: `gid://shopify/Customer/${customer_id}`
    };

    // Add native fields if provided
    if (first_name) updateInput.firstName = first_name;
    if (last_name) updateInput.lastName = last_name;
    if (email) updateInput.email = email;
    if (phone) updateInput.phone = phone;

    // Prepare metafields array
    const metafields = [];

    if (alternate_phone !== undefined) {
      metafields.push({
        namespace: 'custom',
        key: 'alternate_phone',
        value: alternate_phone,
        type: 'single_line_text_field'
      });
    }

    if (gender !== undefined) {
      metafields.push({
        namespace: 'custom',
        key: 'gender',
        value: gender,
        type: 'single_line_text_field'
      });
    }

    if (date_of_birth !== undefined) {
      metafields.push({
        namespace: 'custom',
        key: 'date_of_birth',
        value: date_of_birth,
        type: 'date'
      });
    }

    // Add metafields to update input if any
    if (metafields.length > 0) {
      updateInput.metafields = metafields;
    }

    const mutation = `
      mutation updateCustomer($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer {
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
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = { input: updateInput };

    console.log('🚀 Sending GraphQL mutation to Shopify...');
    console.log('Variables:', JSON.stringify(variables, null, 2));

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
      message: 'Customer updated successfully',
      customer: response.data.data.customerUpdate.customer
    });
  } catch (err) {
    console.error('❌ ERROR updating customer:', err.response?.data || err.message);
    res.status(500).json({ 
      success: false, 
      error: err.response?.data?.errors || err.message 
    });
  }
});

// ============================================
// ENDPOINT 3: Update Customer Profile (Metafields Only - Legacy)
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
// ENDPOINT 4: Get Customer Profile
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
// ENDPOINT 4: Upload Profile Image (Simplified)
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

    // Convert base64 to buffer
    const base64Data = image_url.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    console.log('📦 Image buffer size:', buffer.length, 'bytes');

    // Step 1: Generate staged uploads target
    const stagedUploadMutation = `
      mutation generateStagedUploads($input: [StagedUploadInput!]!) {
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
      input: [{
        resource: "IMAGE",
        filename: `profile_${customer_id}_${Date.now()}.jpg`,
        mimeType: "image/jpeg",
        httpMethod: "POST"
      }]
    };

    console.log('🚀 Creating staged upload...');
    console.log('Variables:', JSON.stringify(stagedUploadVariables, null, 2));

    const stagedResponse = await axios.post(
      `https://${SHOP_NAME}/admin/api/${API_VERSION}/graphql.json`,
      { 
        query: stagedUploadMutation, 
        variables: stagedUploadVariables 
      },
      {
        headers: {
          'X-Shopify-Access-Token': ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('📥 Staged response:', JSON.stringify(stagedResponse.data, null, 2));

    // Check for errors
    const stagedErrors = stagedResponse.data.data?.stagedUploadsCreate?.userErrors;
    if (stagedErrors && stagedErrors.length > 0) {
      console.error('❌ Staged upload errors:', stagedErrors);
      return res.status(400).json({ 
        success: false, 
        error: 'Failed to create staged upload',
        details: stagedErrors
      });
    }

    const stagedTarget = stagedResponse.data.data?.stagedUploadsCreate?.stagedTargets?.[0];
    
    if (!stagedTarget || !stagedTarget.url) {
      console.error('❌ No staged target URL received');
      return res.status(400).json({ 
        success: false, 
        error: 'Failed to get staged upload URL',
        response: stagedResponse.data
      });
    }

    console.log('✅ Staged target URL:', stagedTarget.url);
    console.log('✅ Resource URL:', stagedTarget.resourceUrl);

    // Step 2: Upload file to staged URL
    const formData = new FormData();
    
    // Add all parameters from staged upload
    stagedTarget.parameters.forEach(param => {
      formData.append(param.name, param.value);
    });
    
    // Add the file last
    formData.append('file', buffer, {
      filename: `profile_${customer_id}_${Date.now()}.jpg`,
      contentType: 'image/jpeg'
    });

    console.log('🚀 Uploading file to staged URL...');

    await axios.post(stagedTarget.url, formData, {
      headers: {
        ...formData.getHeaders()
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    console.log('✅ File uploaded successfully');

    // Step 3: Create file in Shopify
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

    console.log('🚀 Creating file in Shopify...');

    const fileCreateResponse = await axios.post(
      `https://${SHOP_NAME}/admin/api/${API_VERSION}/graphql.json`,
      { 
        query: fileCreateMutation, 
        variables: {
          files: [{
            alt: `Profile image for customer ${customer_id}`,
            contentType: "IMAGE",
            originalSource: stagedTarget.resourceUrl
          }]
        }
      },
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
      return res.status(400).json({ 
        success: false, 
        error: 'Failed to create file',
        response: fileCreateResponse.data
      });
    }

    console.log('✅ File created with ID:', fileId);

    // Step 4: Update customer metafield
    const updateMetafieldMutation = `
      mutation updateCustomerMetafield($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer {
            id
            metafields(first: 10, namespace: "custom") {
              edges {
                node {
                  key
                  value
                  type
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

    console.log('🚀 Updating customer metafield with file reference...');

    const metafieldResponse = await axios.post(
      `https://${SHOP_NAME}/admin/api/${API_VERSION}/graphql.json`,
      { 
        query: updateMetafieldMutation, 
        variables: {
          input: {
            id: `gid://shopify/Customer/${customer_id}`,
            metafields: [{
              namespace: 'custom',
              key: 'profile_image',
              value: fileId,
              type: 'file_reference'
            }]
          }
        }
      },
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
      console.error('❌ Metafield errors:', metafieldErrors);
      return res.status(400).json({ success: false, error: metafieldErrors });
    }

    console.log('✅✅✅ Profile image uploaded successfully!');

    res.json({ 
      success: true, 
      message: 'Profile image updated successfully',
      fileId: fileId
    });

  } catch (err) {
    console.error('❌ ERROR uploading image:', err.response?.data || err.message);
    console.error('❌ Error details:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message,
      details: err.response?.data
    });
  }
});

// ============================================
// ENDPOINT: Wishlist - Get / Add / Remove
// ============================================

// GET wishlist - retrieve wishlist array (stored as JSON in custom.wishlist)
app.get('/wishlist', async (req, res) => {
  try {
    const { customer_id } = req.query;
    if (!customer_id) return res.status(400).json({ success: false, error: 'Customer ID is required' });

    const query = `
      query getCustomer($id: ID!) {
        customer(id: $id) {
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
      }
    `;

    const variables = { id: `gid://shopify/Customer/${customer_id}` };

    const response = await axios.post(
      `https://${SHOP_NAME}/admin/api/${API_VERSION}/graphql.json`,
      { query, variables },
      { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
    );

    const edges = response.data.data?.customer?.metafields?.edges || [];
    const node = edges.find(e => e.node.key === 'wishlist');
    let wishlist = [];
    if (node && node.node.value) {
      try { wishlist = JSON.parse(node.node.value); if (!Array.isArray(wishlist)) wishlist = []; } catch (e) { wishlist = []; }
    }

    res.json({ success: true, wishlist });
  } catch (err) {
    console.error('❌ ERROR fetching wishlist:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /wishlist/add - add a product to wishlist
app.post('/wishlist/add', async (req, res) => {
  try {
    const { customer_id, product_id } = req.body;
    if (!customer_id || !product_id) return res.status(400).json({ success: false, error: 'customer_id and product_id required' });

    // Fetch current wishlist
    const query = `
      query getCustomer($id: ID!) {
        customer(id: $id) {
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
      }
    `;

    const variables = { id: `gid://shopify/Customer/${customer_id}` };

    const response = await axios.post(
      `https://${SHOP_NAME}/admin/api/${API_VERSION}/graphql.json`,
      { query, variables },
      { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
    );

    const edges = response.data.data?.customer?.metafields?.edges || [];
    const node = edges.find(e => e.node.key === 'wishlist');
    let wishlist = [];
    if (node && node.node.value) {
      try { wishlist = JSON.parse(node.node.value); if (!Array.isArray(wishlist)) wishlist = []; } catch (e) { wishlist = []; }
    }

    const pid = String(product_id);
    if (!wishlist.includes(pid)) wishlist.push(pid);

    // Update metafield
    const mutation = `
      mutation updateCustomerMetafields($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer { id metafields(first: 10, namespace: "custom") { edges { node { key value } } } }
          userErrors { field message }
        }
      }
    `;

    const updateVars = {
      input: {
        id: `gid://shopify/Customer/${customer_id}`,
        metafields: [{ namespace: 'custom', key: 'wishlist', value: JSON.stringify(wishlist), type: 'single_line_text_field' }]
      }
    };

    const updateResponse = await axios.post(
      `https://${SHOP_NAME}/admin/api/${API_VERSION}/graphql.json`,
      { query: mutation, variables: updateVars },
      { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
    );

    const errors = updateResponse.data.data?.customerUpdate?.userErrors;
    if (errors && errors.length > 0) {
      console.error('❌ Shopify errors:', errors);
      return res.status(400).json({ success: false, error: errors });
    }

    res.json({ success: true, wishlist });
  } catch (err) {
    console.error('❌ ERROR adding to wishlist:', err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.response?.data || err.message });
  }
});

// POST /wishlist/remove - remove a product from wishlist
app.post('/wishlist/remove', async (req, res) => {
  try {
    const { customer_id, product_id } = req.body;
    if (!customer_id || !product_id) return res.status(400).json({ success: false, error: 'customer_id and product_id required' });

    // Fetch current wishlist
    const query = `
      query getCustomer($id: ID!) {
        customer(id: $id) {
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
      }
    `;

    const variables = { id: `gid://shopify/Customer/${customer_id}` };

    const response = await axios.post(
      `https://${SHOP_NAME}/admin/api/${API_VERSION}/graphql.json`,
      { query, variables },
      { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
    );

    const edges = response.data.data?.customer?.metafields?.edges || [];
    const node = edges.find(e => e.node.key === 'wishlist');
    let wishlist = [];
    if (node && node.node.value) {
      try { wishlist = JSON.parse(node.node.value); if (!Array.isArray(wishlist)) wishlist = []; } catch (e) { wishlist = []; }
    }

    const pid = String(product_id);
    const newWishlist = wishlist.filter(p => String(p) !== pid);

    // Update metafield
    const mutation = `
      mutation updateCustomerMetafields($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer { id metafields(first: 10, namespace: "custom") { edges { node { key value } } } }
          userErrors { field message }
        }
      }
    `;

    const updateVars = {
      input: {
        id: `gid://shopify/Customer/${customer_id}`,
        metafields: [{ namespace: 'custom', key: 'wishlist', value: JSON.stringify(newWishlist), type: 'single_line_text_field' }]
      }
    };

    const updateResponse = await axios.post(
      `https://${SHOP_NAME}/admin/api/${API_VERSION}/graphql.json`,
      { query: mutation, variables: updateVars },
      { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
    );

    const errors = updateResponse.data.data?.customerUpdate?.userErrors;
    if (errors && errors.length > 0) {
      console.error('❌ Shopify errors:', errors);
      return res.status(400).json({ success: false, error: errors });
    }

    res.json({ success: true, wishlist: newWishlist });
  } catch (err) {
    console.error('❌ ERROR removing from wishlist:', err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.response?.data || err.message });
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