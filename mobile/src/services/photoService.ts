/**
 * services/photoService.ts
 *
 * Handles camera capture and photo-library selection using expo-image-picker.
 * Copies captured images into the app's permanent document directory so they
 * persist even if the camera roll is cleared.
 * Returns the local file path to be stored in SQLite.
 */
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem  from 'expo-file-system/legacy';
import { v4 as uuidv4 } from 'uuid';

const PHOTOS_DIR = `${FileSystem.documentDirectory}survey-photos/`;

// ----------------------------------------------------------------
// Ensure the photo storage directory exists
// ----------------------------------------------------------------
async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(PHOTOS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PHOTOS_DIR, { intermediates: true });
  }
}

export interface CapturedPhoto {
  uri:      string;  // permanent local file path
  mimeType: string;
  width:    number;
  height:   number;
}

// ----------------------------------------------------------------
// Camera capture
// ----------------------------------------------------------------
export async function captureFromCamera(): Promise<CapturedPhoto | null> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Camera permission denied. Please enable it in Settings.');
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 0.85,
    exif: false,
  });

  if (result.canceled || !result.assets?.length) return null;

  return _copyToDocuments(result.assets[0]);
}

// ----------------------------------------------------------------
// Photo library picker
// ----------------------------------------------------------------
export async function pickFromLibrary(): Promise<CapturedPhoto | null> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Photo library permission denied. Please enable it in Settings.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 0.85,
    exif: false,
  });

  if (result.canceled || !result.assets?.length) return null;

  return _copyToDocuments(result.assets[0]);
}

// ----------------------------------------------------------------
// Copy a picked/captured asset into the app's documents directory
// ----------------------------------------------------------------
async function _copyToDocuments(
  asset: ImagePicker.ImagePickerAsset
): Promise<CapturedPhoto> {
  await ensureDir();

  const ext      = (asset.mimeType ?? 'image/jpeg') === 'image/png' ? '.png' : '.jpg';
  const filename = `${uuidv4()}${ext}`;
  const destPath = `${PHOTOS_DIR}${filename}`;

  await FileSystem.copyAsync({ from: asset.uri, to: destPath });

  return {
    uri:      destPath,
    mimeType: asset.mimeType ?? 'image/jpeg',
    width:    asset.width    ?? 0,
    height:   asset.height   ?? 0,
  };
}

// ----------------------------------------------------------------
// Delete a stored photo file
// ----------------------------------------------------------------
export async function deletePhotoFile(filePath: string): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(filePath);
    if (info.exists) {
      await FileSystem.deleteAsync(filePath, { idempotent: true });
    }
  } catch { /* ignore delete errors */ }
}
