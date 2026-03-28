import React, { useState } from "react";
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
import axios from "axios";
import { API_URL } from "../api/client";
import { useAuth } from "../context/AuthContext";

interface UploadResponse {
  filePath: string;
}

export default function NewSurveyScreen() {
  const router = useRouter();
  const { token, user } = useAuth();

  const [roofPitch, setRoofPitch] = useState("");
  const [azimuth, setAzimuth] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    const pitchValue = Number(roofPitch);
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

      await axios.post(
        `${API_URL}/api/surveys`,
        {
          project_name: `Roof Survey ${new Date().toISOString().slice(0, 10)}`,
          inspector_name: user?.fullName ?? "Mobile Inspector",
          site_name: "Mobile Roof Survey",
          category_name: "Roof Mount",
          status: "draft",
          notes: noteParts.join("\n"),
          metadata: {
            type: "roof_mount",
            roof_material: null,
            rafter_size: null,
            rafter_spacing: null,
            roof_age_years: null,
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

      Alert.alert("Success", "Survey submitted successfully.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? ((error.response?.data?.error as string | undefined) ?? error.message)
        : "Failed to submit survey";
      Alert.alert("Submission Error", message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>New Solar Survey</Text>

          <Text style={styles.label}>Roof Pitch</Text>
          <TextInput
            style={styles.input}
            value={roofPitch}
            onChangeText={setRoofPitch}
            keyboardType="numeric"
            placeholder="Enter roof pitch (0-90)"
            placeholderTextColor="#9ca3af"
          />

          <Text style={styles.label}>Azimuth</Text>
          <TextInput
            style={styles.input}
            value={azimuth}
            onChangeText={setAzimuth}
            keyboardType="numeric"
            placeholder="Enter azimuth (0-360)"
            placeholderTextColor="#9ca3af"
          />

          <TouchableOpacity
            style={styles.captureButton}
            onPress={capturePhoto}
            disabled={submitting}
          >
            <Text style={styles.captureButtonText}>Capture Photo</Text>
          </TouchableOpacity>

          <Text style={styles.photoText}>
            {photoUri
              ? `Photo selected: ${photoUri.split("/").pop() ?? "captured"}`
              : "No photo selected"}
          </Text>

          <TouchableOpacity
            style={[
              styles.submitButton,
              submitting && styles.submitButtonDisabled,
            ]}
            onPress={submitSurvey}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.submitButtonText}>Submit Survey</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: "#0b1220",
  },
  container: {
    padding: 20,
    gap: 12,
  },
  title: {
    color: "#f8fafc",
    fontSize: 26,
    fontWeight: "700",
    marginBottom: 12,
  },
  label: {
    color: "#cbd5e1",
    fontSize: 15,
    fontWeight: "600",
  },
  input: {
    backgroundColor: "#111827",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 10,
    color: "#f8fafc",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  captureButton: {
    marginTop: 8,
    borderRadius: 10,
    backgroundColor: "#1d4ed8",
    paddingVertical: 12,
    alignItems: "center",
  },
  captureButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 16,
  },
  photoText: {
    color: "#94a3b8",
    fontSize: 13,
    marginBottom: 10,
  },
  submitButton: {
    borderRadius: 10,
    backgroundColor: "#059669",
    paddingVertical: 14,
    alignItems: "center",
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 16,
  },
});
