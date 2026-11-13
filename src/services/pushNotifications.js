import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from '../../lib/supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: false,
    shouldShowList: true,
  }),
});

const runningInExpoGo =
  Constants.executionEnvironment === 'storeClient' ||
  Constants.appOwnership === 'expo';

export async function registerForPushNotifications(userId) {
  // Expo Go no longer supports Android remote push. Skip registration there so
  // the app does not log a failure; a development build is required for push.
  if (runningInExpoGo) {
    return null;
  }

  try {

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Messages',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        sound: 'default',
      });
    }

    if (!Device.isDevice) {
      console.log('Push notifications require a physical device.');
      return null;
    }

    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();

    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Notification permission not granted.');
      return null;
    }

    const projectId =
      Constants.easConfig?.projectId ||
      Constants.expoConfig?.extra?.eas?.projectId;

    if (!projectId) {
      throw new Error('Expo project ID not found.');
    }

    const tokenResponse = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    const token = tokenResponse.data;

    const { error } = await supabase
      .from('user_push_tokens')
      .upsert(
        {
          user_id: userId,
          expo_push_token: token,
          platform: Platform.OS,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,expo_push_token' }
      );

    if (error) throw error;

    console.log('Push token registered successfully.');
    return token;
  } catch (error) {
    console.log('Push registration error:', error.message);
    return null;
  }
}
