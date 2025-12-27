/**
 * Supabase Storage Service
 *
 * Handles image storage for generated face swap results.
 * Uses Supabase Storage with a publicly readable 'generations' bucket.
 */

const { supabase } = require('../lib/supabase');

const BUCKET_NAME = 'generations';

/**
 * Upload an image to Supabase Storage
 * @param {Buffer} buffer - The image data as a Buffer
 * @param {string} filename - The filename to save as (e.g., 'abc123.png')
 * @returns {Promise<{url: string|null, error: Error|null}>}
 */
async function uploadImage(buffer, filename) {
  if (!supabase) {
    console.error('[Storage] Supabase client not configured');
    return { url: null, error: new Error('Supabase not configured') };
  }

  try {
    // Upload the file to Supabase Storage
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filename, buffer, {
        contentType: 'image/png',
        upsert: true, // Overwrite if exists
      });

    if (error) {
      console.error('[Storage] Upload failed:', error.message);
      return { url: null, error };
    }

    // Get the public URL for the uploaded file
    const { url, error: urlError } = getPublicUrl(filename);

    if (urlError) {
      console.error('[Storage] Failed to get public URL:', urlError.message);
      return { url: null, error: urlError };
    }

    console.log('[Storage] Image uploaded successfully:', filename);
    return { url, error: null };
  } catch (err) {
    console.error('[Storage] Unexpected error during upload:', err.message);
    return { url: null, error: err };
  }
}

/**
 * Delete an image from Supabase Storage
 * @param {string} filename - The filename to delete
 * @returns {Promise<{success: boolean, error: Error|null}>}
 */
async function deleteImage(filename) {
  if (!supabase) {
    console.error('[Storage] Supabase client not configured');
    return { success: false, error: new Error('Supabase not configured') };
  }

  try {
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([filename]);

    if (error) {
      console.error('[Storage] Delete failed:', error.message);
      return { success: false, error };
    }

    console.log('[Storage] Image deleted successfully:', filename);
    return { success: true, error: null };
  } catch (err) {
    console.error('[Storage] Unexpected error during delete:', err.message);
    return { success: false, error: err };
  }
}

/**
 * Get the public URL for an image in storage
 * @param {string} filename - The filename to get URL for
 * @returns {{url: string|null, error: Error|null}}
 */
function getPublicUrl(filename) {
  if (!supabase) {
    console.error('[Storage] Supabase client not configured');
    return { url: null, error: new Error('Supabase not configured') };
  }

  try {
    const { data } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filename);

    if (!data || !data.publicUrl) {
      return { url: null, error: new Error('Failed to generate public URL') };
    }

    return { url: data.publicUrl, error: null };
  } catch (err) {
    console.error('[Storage] Unexpected error getting public URL:', err.message);
    return { url: null, error: err };
  }
}

module.exports = {
  uploadImage,
  deleteImage,
  getPublicUrl,
  BUCKET_NAME,
};
