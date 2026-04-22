import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import axios from "axios";
import { API_URL } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { convertPitchToDegrees } from "../services/pitch";
import { uploadInferAndSyncSurveyPhotos } from "../services/photoInferencePipeline";
import { solarProTheme } from "../theme/solarProTheme";

const { colors } = solarProTheme;
const AUTO_SAVE_INTERVAL_MS = 300_000;
const DRAFTS_DIR = `${FileSystem.documentDirectory}survey-drafts/`;

interface UploadResponse {
  filePath: string;
}

interface CreatedSurveyResponse {
  id: string;
  project_id?: string | null;
}

interface NewSurveyDraft {
  saved_at: string;
  roof_pitch: string;
  azimuth: string;
  photo_uri: string | null;
  user_id: string | null;
}

function getPitchPreview(value: string): {
  degrees: number | null;
  error: string | null;
} {
  const trimmed = value.trim();
  if (!trimmed) {
    return { degrees: null, error: null };
  }

  if (trimmed.includes("/")) {
    try {
      return { degrees: convertPitchToDegrees(trimmed), error: null };
    } catch {
      return {
        degrees: null,
        error: "Invalid ratio. Use Rise/Run like 5/12.",
      };
    }
  }

  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) {
    return { degrees: null, error: "Enter degrees or ratio like 5/12." };
  }

  return { degrees: numeric, error: null };
}

export default function NewSurveyScreen() {
  const router = useRouter();
  const { token, user } = useAuth();

  const [roofPitch, setRoofPitch] = useState("");
  const [azimuth, setAzimuth] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [draftFileUri, setDraftFileUri] = useState<string | null>(null);

  const buildDraftPayload = useCallback((): NewSurveyDraft => ({
    saved_at: new Date().toISOString(),
    roof_pitch: roofPitch,
    azimuth,
    photo_uri: photoUri,
    user_id: user?.id ?? null,
  }), [roofPitch, azimuth, photoUri, user?.id]);

  const saveDraftToFile = useCallback(async () => {
    if (!draftFileUri) return;
    await FileSystem.writeAsStringAsync(
      draftFileUri,
      JSON.stringify(buildDraftPayload(), null, 2),
      { encoding: FileSystem.EncodingType.UTF8 },
    );
  }, [buildDraftPayload, draftFileUri]);

  // Create a new draft file when the screen opens
  useEffect(() => {
    let mounted = true;

    async function initDraftFile() {
      try {
        await FileSystem.makeDirectoryAsync(DRAFTS_DIR, { intermediates: true });
        const uri = `${DRAFTS_DIR}draft-${Date.now()}.json`;
        await FileSystem.writeAsStringAsync(
          uri,
          JSON.stringify(buildDraftPayload(), null, 2),
          { encoding: FileSystem.EncodingType.UTF8 },
        );
        if (mounted) {
          setDraftFileUri(uri);
        }
      } catch (err) {
        console.error("Draft init error:", err);
      }
    }

    initDraftFile();
    return () => {
      mounted = false;
    };
  }, [buildDraftPayload]);

  // Auto-save draft every 300 seconds and once on unmount
  useEffect(() => {
    if (!draftFileUri) return;

    const timer = setInterval(() => {
      saveDraftToFile().catch((err) => console.error("Draft autosave error:", err));
    }, AUTO_SAVE_INTERVAL_MS);

    return () => {
      clearInterval(timer);
      saveDraftToFile().catch((err) => console.error("Draft final save error:", err));
    };
  }, [draftFileUri, saveDraftToFile]);

  const pitchPreview = getPitchPreview(roofPitch);

  async function capturePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Camera Permission Needed",
        "Please allow camera access to capture a photo.",
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });

    if (!result.canceled && result.assets.length > 0) {
      setPhotoUri(result.assets[0].uri);
    }
  }

  function validateInputs(): {
    pitchValue: number;
    azimuthValue: number;
  } | null {
    const trimmedPitch = roofPitch.trim();
    let pitchValue: number;

    try {
      pitchValue = trimmedPitch.includes("/")
        ? convertPitchToDegrees(trimmedPitch)
        : Number(trimmedPitch);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Invalid pitch format. Use 'Rise/Run' (e.g., 4/12)";
      Alert.alert("Validation Error", message);
      return null;
    }

    const azimuthValue = Number(azimuth);

    if (!Number.isFinite(pitchValue) || pitchValue < 0 || pitchValue > 90) {
      Alert.alert(
        "Validation Error",
        "Roof Pitch must be a number between 0 and 90.",
      );
      return null;
    }

    if (
      !Number.isFinite(azimuthValue) ||
      azimuthValue < 0 ||
      azimuthValue > 360
    ) {
      Alert.alert(
        "Validation Error",
        "Azimuth must be a number between 0 and 360.",
      );
      return null;
    }

    return { pitchValue, azimuthValue };
  }

  async function submitSurvey() {
    if (!token) {
      Alert.alert(
        "Authentication Required",
        "Please sign in before creating a survey.",
      );
      return;
    }

    const values = validateInputs();
    if (!values) return;

    setSubmitting(true);
    try {
      let uploadedFilePath: string | null = null;

      if (photoUri) {
        const formData = new FormData();
        formData.append("image", {
          uri: photoUri,
          name: "roof-photo.jpg",
          type: "image/jpeg",
        } as never);

        const uploadResponse = await axios.post<UploadResponse>(
          `${API_URL}/api/surveys/upload`,
          formData,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "multipart/form-data",
            },
          },
        );

        uploadedFilePath = uploadResponse.data.filePath;
      }

      const noteParts = [`Roof pitch: ${values.pitchValue}°`];
      if (uploadedFilePath) {
        noteParts.push(`Photo: ${uploadedFilePath}`);
      }

      // Create survey
      const surveyResponse = await axios.post<CreatedSurveyResponse>(
        `${API_URL}/api/surveys`,
        {
          project_name: "Mobile Photo Capture",
          inspector_name: user?.fullName ?? "Mobile Inspector",
          site_name: "Solar Site",
          category_name: "Electrical",
          status: "draft",
          notes: noteParts.join(" | "),
          metadata: {
            type: "roof_mount",
            azimuth: values.azimuthValue,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );

      const surveyId = surveyResponse.data.id;

      // Upload/inference is best-effort; survey creation should still succeed
      // even if downstream analysis fails.
      if (photoUri) {
        try {
          await uploadInferAndSyncSurveyPhotos({
            surveyId,
            projectId: surveyResponse.data.project_id ?? surveyId,
            authToken: token,
            photos: [
              {
                uri: photoUri,
                label: "Roof Photo",
                mimeType: "image/jpeg",
              },
            ],
            roofType: "shingle",
          });
        } catch (pipelineError) {
          console.warn("Photo inference pipeline failed:", pipelineError);
        }
      }

      // Remove local draft after successful submit
      if (draftFileUri) {
        await FileSystem.deleteAsync(draftFileUri, { idempotent: true });
      }

      Alert.alert("Success", "Survey created successfully!");
      router.push({ pathname: '/survey/[id]', params: { id: surveyId } });
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? ((error.response?.data?.error as string | undefined) ?? error.message)
        : "Failed to create survey";
      Alert.alert("Error", message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.title}>New Survey</Text>
          <Text style={styles.autoSaveHint}>Auto-saving draft every 300 seconds</Text>

          <View style={styles.section}>
            <Text style={styles.label}>Roof Pitch</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter pitch (e.g., 5/12 or 22.6)"
              value={roofPitch}
              onChangeText={setRoofPitch}
              placeholderTextColor={colors.textMuted}
            />
            {pitchPreview.degrees !== null && (
              <Text style={styles.preview}>
                ✓ {pitchPreview.degrees.toFixed(1)}°
              </Text>
            )}
            {pitchPreview.error && (
              <Text style={styles.error}>{pitchPreview.error}</Text>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Azimuth (0-360°)</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter azimuth direction"
              value={azimuth}
              onChangeText={setAzimuth}
              keyboardType="numeric"
              placeholderTextColor={colors.textMuted}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Photo</Text>
            {photoUri ? (
              <View style={styles.photoPreview}>
                <Text style={styles.photoText}>✓ Photo selected</Text>
                <TouchableOpacity
                  style={styles.changePhotoBtn}
                  onPress={capturePhoto}
                >
                  <Text style={styles.btnText}>Change Photo</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.captureBtn} onPress={capturePhoto}>
                <Text style={styles.btnText}>📷 Capture Photo</Text>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={submitSurvey}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.btnText}>Create Survey</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 8,
  },
  autoSaveHint: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 16,
  },
  section: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 6,
    padding: 12,
    color: colors.textPrimary,
    fontSize: 16,
  },
  preview: {
    color: colors.successText,
    fontSize: 12,
    marginTop: 4,
  },
  error: {
    color: colors.errorText,
    fontSize: 12,
    marginTop: 4,
  },
  photoPreview: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 6,
    padding: 16,
    alignItems: "center",
    gap: 12,
  },
  photoText: {
    color: colors.successText,
    fontSize: 16,
  },
  captureBtn: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    padding: 14,
    alignItems: "center",
  },
  changePhotoBtn: {
    backgroundColor: colors.inputBorder,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  submitBtn: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    padding: 14,
    alignItems: "center",
    marginTop: 24,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: "600",
  },
});
