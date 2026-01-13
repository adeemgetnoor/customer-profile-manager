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

// Helper: normalize wishlist entries (strings -> objects)
function normalizeWishlistEntries(list) {
  return list.map(item => {
    if (typeof item === 'string' || typeof item === 'number') {
      return { id: String(item) };
    } else if (item && typeof item === 'object') {
      return item;
    } else {
      return item;
    }
  });
}

// Helper: fetch basic product data by product_id using REST API
async function fetchProductById(product_id) {
  try {
    const resp = await axios.get(`https://${SHOP_NAME}/admin/api/${API_VERSION}/products/${product_id}.json`, {
      headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' }
    });
    const p = resp.data.product;
    return {
      id: String(p.id),
      handle: p.handle,
      title: p.title,
      image: p.image ? p.image.src : null
    };
  } catch (e) {
    console.error('❌ Error fetching product by id:', e.response?.data || e.message);
    return null;
  }
}

function gidToId(gid) {
  if (!gid) return gid;
  const parts = String(gid).split('/');
  return parts[parts.length - 1];
}

// Helper: fetch product by handle via GraphQL
async function fetchProductByHandle(handle) {
  try {
    const query = `
      query productByHandle($handle: String!) {
        productByHandle(handle: $handle) {
          id
          handle
          title
          images(first: 1) {
            edges {
              node {
                url
              }
            }
          }
        }
      }
    `;

    const variables = { handle };

    const resp = await axios.post(
      `https://${SHOP_NAME}/admin/api/${API_VERSION}/graphql.json`,
      { query, variables },
      { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
    );

    const p = resp.data.data?.productByHandle;
    if (!p) return null;

    const id = gidToId(p.id);
    return {
      id: String(id),
      handle: p.handle,
      title: p.title,
      image: p.images?.edges?.[0]?.node?.url || null
    };
  } catch (e) {
    console.error('❌ Error fetching product by handle:', e.response?.data || e.message);
    return null;
  }
}

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
      getWishlist: '/wishlist?customer_id=xxx (GET) - Get wishlist items (normalized objects with id/handle)',
      addWishlist: '/wishlist/add (POST) - Add product to wishlist { customer_id, product_id|product_handle|product }',
      removeWishlist: '/wishlist/remove (POST) - Remove product from wishlist { customer_id, product_id|product_handle|product }',
      attachHandles: '/wishlist/attach-handles (POST) - Attach or set handles for wishlist items { customer_id, mappings: [{ id, handle }] }'
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

// GET wishlist - retrieve wishlist array (stored as JSON in custom.wishlist). Returns objects containing at least { id } or { handle }.
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

    // Normalize entries (support legacy string ids)
    wishlist = normalizeWishlistEntries(wishlist);

    // Optional: expand items that only have ids when expand=true
    if (req.query.expand === 'true') {
      for (let i = 0; i < wishlist.length; i++) {
        const item = wishlist[i];
        if (item && item.id && (!item.title && !item.handle)) {
          const fetched = await fetchProductById(item.id);
          if (fetched) wishlist[i] = { ...item, ...fetched };
        }
      }
    }

    // Backfill handles for items with id but no handle, and persist the enriched wishlist
    try {
      let needSave = false;
      for (let i = 0; i < wishlist.length; i++) {
        const item = wishlist[i];
        if (item && item.id && !item.handle) {
          const fetched = await fetchProductById(item.id);
          if (fetched && fetched.handle) {
            wishlist[i] = { ...item, ...fetched };
            needSave = true;
          }
        }
      }

      if (needSave) {
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

        try {
          const saveResponse = await axios.post(
            `https://${SHOP_NAME}/admin/api/${API_VERSION}/graphql.json`,
            { query: mutation, variables: updateVars },
            { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
          );

          const saveErrors = saveResponse.data.data?.customerUpdate?.userErrors;
          if (saveErrors && saveErrors.length > 0) {
            console.error('❌ Shopify errors saving enriched wishlist:', saveErrors);
          } else {
            console.log('✅ Wishlist enriched and saved with product handles');
          }
        } catch (saveErr) {
          console.error('❌ Error saving enriched wishlist:', saveErr.response?.data || saveErr.message);
        }
      }
    } catch (e) {
      console.error('❌ Error during wishlist backfill:', e.message);
    }

    res.json({ success: true, wishlist });
  } catch (err) {
    console.error('❌ ERROR fetching wishlist:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /wishlist/add - add a product to wishlist. Accepts product_id, product_handle or full product object (product).
app.post('/wishlist/add', async (req, res) => {
  try {
    const { customer_id, product_id, product_handle, product } = req.body;
    if (!customer_id || (!product_id && !product_handle && !product)) return res.status(400).json({ success: false, error: 'customer_id and product_id|product_handle|product required' });

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

    // Normalize existing entries
    wishlist = normalizeWishlistEntries(wishlist);

    // Build new product data
    let newProduct = null;
    if (product && typeof product === 'object') {
      newProduct = product;
    } else if (product_handle) {
      newProduct = { handle: String(product_handle) };
    } else if (product_id) {
      const fetched = await fetchProductById(product_id);
      newProduct = fetched || { id: String(product_id) };
    }

    // Avoid duplicates (prefer handle, then id)
    const exists = wishlist.some(item => {
      if (newProduct.handle && item.handle) return item.handle === newProduct.handle;
      if (newProduct.id && item.id) return String(item.id) === String(newProduct.id);
      return false;
    });

    if (!exists) wishlist.push(newProduct);

    // Update metafield (store objects)
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

// POST /wishlist/remove - remove a product from wishlist. Accepts product_id, product_handle or full product object (product).
app.post('/wishlist/remove', async (req, res) => {
  try {
    const { customer_id, product_id, product_handle, product } = req.body;
    if (!customer_id || (!product_id && !product_handle && !product)) return res.status(400).json({ success: false, error: 'customer_id and product_id|product_handle|product required' });

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

    // Normalize existing entries
    wishlist = normalizeWishlistEntries(wishlist);

    // Determine removal key
    let handleToRemove = null;
    let idToRemove = null;

    if (product && typeof product === 'object') {
      if (product.handle) handleToRemove = String(product.handle);
      if (product.id) idToRemove = String(product.id);
    }
    if (product_handle) handleToRemove = String(product_handle);
    if (product_id) idToRemove = String(product_id);

    const newWishlist = wishlist.filter(item => {
      if (handleToRemove && item.handle) return item.handle !== handleToRemove;
      if (idToRemove && item.id) return String(item.id) !== idToRemove;
      // If wishlist items are objects that don't match the removal keys, keep them
      return true;
    });

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

// POST /wishlist/attach-handles - attach handles to existing wishlist items or add items by handle
app.post('/wishlist/attach-handles', async (req, res) => {
  try {
    const { customer_id, mappings } = req.body;
    if (!customer_id || !mappings) return res.status(400).json({ success: false, error: 'customer_id and mappings are required' });

    const items = Array.isArray(mappings) ? mappings : [mappings];

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

    // Normalize existing entries
    wishlist = normalizeWishlistEntries(wishlist);

    let changed = false;

    for (const mapping of items) {
      const mappingId = mapping?.id ? String(mapping.id) : null;
      const mappingHandle = mapping?.handle ? String(mapping.handle) : null;

      if (!mappingId && !mappingHandle) continue;

      if (mappingHandle) {
        // Try to fetch product by handle to enrich
        const fetched = await fetchProductByHandle(mappingHandle);

        // Try to find existing by id first, then by handle
        let foundIndex = -1;
        if (mappingId) foundIndex = wishlist.findIndex(w => w && String(w.id) === mappingId);
        if (foundIndex === -1 && fetched) foundIndex = wishlist.findIndex(w => w && w.handle === fetched.handle);

        if (foundIndex !== -1) {
          wishlist[foundIndex] = { ...(wishlist[foundIndex] || {}), ...(fetched || { handle: mappingHandle }) };
          changed = true;
        } else {
          // Add new item if not duplicate
          const exists = wishlist.some(w => (fetched && fetched.handle && w.handle === fetched.handle) || (mappingId && w.id && String(w.id) === mappingId));
          if (!exists) {
            wishlist.push(fetched || (mappingId ? { id: mappingId, handle: mappingHandle } : { handle: mappingHandle }));
            changed = true;
          }
        }

      } else if (mappingId) {
        // Only id provided: try to fetch product to get handle
        const idx = wishlist.findIndex(w => w && String(w.id) === mappingId);
        if (idx !== -1) {
          const fetched = await fetchProductById(mappingId);
          if (fetched && fetched.handle && fetched.handle !== wishlist[idx].handle) {
            wishlist[idx] = { ...(wishlist[idx] || {}), ...fetched };
            changed = true;
          }
        }
      }
    }

    // Persist changes if any
    if (changed) {
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

      try {
        const saveResponse = await axios.post(
          `https://${SHOP_NAME}/admin/api/${API_VERSION}/graphql.json`,
          { query: mutation, variables: updateVars },
          { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
        );

        const saveErrors = saveResponse.data.data?.customerUpdate?.userErrors;
        if (saveErrors && saveErrors.length > 0) {
          console.error('❌ Shopify errors saving attached handles:', saveErrors);
        } else {
          console.log('✅ Attached handles saved to wishlist');
        }
      } catch (saveErr) {
        console.error('❌ Error saving attached handles:', saveErr.response?.data || saveErr.message);
      }
    }

    res.json({ success: true, wishlist });
  } catch (err) {
    console.error('❌ ERROR attaching handles to wishlist:', err.response?.data || err.message);
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