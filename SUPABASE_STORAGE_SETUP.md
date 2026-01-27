# 📦 Supabase Storage Setup Guide

## Step 1: Get Supabase Credentials

1. Go to [supabase.com](https://supabase.com) and sign in
2. Open your project (the one connected to your DATABASE_URL)
3. Go to **Settings** → **API**
4. Copy these values:
   - **Project URL** (example: `https://xxxxx.supabase.co`)
   - **anon/public key** (the long key under "Project API keys")

## Step 2: Create Storage Bucket

1. In your Supabase project, go to **Storage** in the left sidebar
2. Click **Create a new bucket**
3. Set the following:
   - **Name**: `social-planner-media`
   - **Public bucket**: ✅ **YES** (check this box)
   - **File size limit**: 50 MB (default is fine)
4. Click **Create bucket**

## Step 3: Configure Bucket Policies

1. Click on the `social-planner-media` bucket
2. Go to **Policies** tab
3. Click **New Policy** → **For full customization**
4. Create **INSERT policy**:
   - Name: `Allow public uploads`
   - Policy: Select **INSERT** operation
   - **USING expression**: `true` (allows anyone to upload)
   - Click **Review** → **Save policy**

5. Create **SELECT policy**:
   - Name: `Allow public reads`
   - Policy: Select **SELECT** operation
   - **USING expression**: `true` (allows anyone to read)
   - Click **Review** → **Save policy**

6. Create **DELETE policy** (optional, for cleanup):
   - Name: `Allow public deletes`
   - Policy: Select **DELETE** operation
   - **USING expression**: `true`
   - Click **Review** → **Save policy**

## Step 4: Add Credentials to .env

Add these lines to your `.env` file:

```bash
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here
```

Replace with the actual values from Step 1.

## Step 5: Test Storage (Optional)

Run this command to test the storage connection:

```bash
node -e "const {initStorage} = require('./storage'); initStorage() ? console.log('✅ Storage OK') : console.log('❌ Storage failed')"
```

---

## 🎯 What This Does

- **Before**: Media stored as base64 in PostgreSQL (5MB image = 6.7MB in DB)
- **After**: Media stored in Supabase Storage, only URL in DB (5MB image = 50 bytes in DB)

**Result**:
- 99% reduction in database egress ✅
- Faster queries ✅
- No memory issues ✅

---

## 📋 Checklist

- [ ] Got SUPABASE_URL from Settings → API
- [ ] Got SUPABASE_ANON_KEY from Settings → API
- [ ] Created `social-planner-media` bucket (public)
- [ ] Created INSERT policy (allow public uploads)
- [ ] Created SELECT policy (allow public reads)
- [ ] Added credentials to `.env` file
- [ ] Tested storage connection

**Once completed, tell the developer and they will continue with the migration.**
