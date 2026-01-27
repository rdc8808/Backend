# Supabase Storage Policies Fix

## ERROR: `new row violates row-level security policy`

This means the bucket policies are too restrictive. You need to add INSERT permission.

## Fix Steps:

### 1. Go to Supabase Storage Policies
https://supabase.com/dashboard/project/duppfujuhmoovnbodhxx/storage/policies

### 2. Find the `social-planner-media` bucket

### 3. Add INSERT Policy

Click **"New Policy"** → Choose **"Custom"**

**Policy Name:** `Allow public uploads`

**Policy Definition:**
```sql
(bucket_id = 'social-planner-media'::text)
```

**Allowed Operations:**
- Check: `INSERT` ✅

**Target Roles:**
- Check: `public` ✅

Click **"Save"**

### 4. Add SELECT Policy (if not exists)

Click **"New Policy"** → Choose **"Custom"**

**Policy Name:** `Allow public reads`

**Policy Definition:**
```sql
(bucket_id = 'social-planner-media'::text)
```

**Allowed Operations:**
- Check: `SELECT` ✅

**Target Roles:**
- Check: `public` ✅

Click **"Save"**

### 5. Add DELETE Policy (for cleanup)

Click **"New Policy"** → Choose **"Custom"**

**Policy Name:** `Allow public deletes`

**Policy Definition:**
```sql
(bucket_id = 'social-planner-media'::text)
```

**Allowed Operations:**
- Check: `DELETE` ✅

**Target Roles:**
- Check: `public` ✅

Click **"Save"**

---

## Alternative: Use SQL Editor

Go to SQL Editor and run:

```sql
-- Allow INSERT (uploads)
CREATE POLICY "Allow public uploads"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'social-planner-media');

-- Allow SELECT (downloads)
CREATE POLICY "Allow public reads"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'social-planner-media');

-- Allow DELETE (cleanup)
CREATE POLICY "Allow public deletes"
ON storage.objects FOR DELETE
TO public
USING (bucket_id = 'social-planner-media');
```

---

## After Adding Policies

Redeploy Render or test upload again. The error should disappear.
