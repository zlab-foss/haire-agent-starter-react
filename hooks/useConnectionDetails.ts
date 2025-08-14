import { useCallback, useEffect, useMemo } from 'react';
import { ConnectionDetails } from '@/app/api/connection-details/route';
import { ManualConnectionCredentialsProvider } from '@/agent-sdk/agent-session/ConnectionCredentialsProvider';

export default function useConnectionDetails() {
  // Generate room connection details, including:
  //   - A random Room name
  //   - A random Participant name
  //   - An Access Token to permit the participant to join the room
  //   - The URL of the LiveKit server to connect to
  //
  // In real-world application, you would likely allow the user to specify their
  // own participant name, and possibly to choose from existing rooms to join.

  const fetchConnectionDetails = useCallback(async () => {
    const url = new URL(
      process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details',
      window.location.origin
    );

    let data: ConnectionDetails;
    try {
      const res = await fetch(url.toString());
      data = await res.json();
    } catch (error) {
      console.error('Error fetching connection details:', error);
      throw new Error('Error fetching connection details!');
    }

    return data;
  }, []);

  const provider = useMemo(
    () => new ManualConnectionCredentialsProvider(fetchConnectionDetails),
    [fetchConnectionDetails],
  );

  useEffect(() => {
    provider.refresh();
  }, [provider]);

  return { connectionDetailsProvider: provider };
}
