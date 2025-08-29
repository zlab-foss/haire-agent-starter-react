"use client";

import { useEffect, useState } from "react";
import { AgentRoomAudioRenderer, AgentStartAudio, AgentVideoTrack, createUseAgentSession } from "@/agent-sdk";
import { ManualConnectionCredentialsProvider } from "@/agent-sdk/agent-session/ConnectionCredentialsProvider";
import { Button } from "./ui/button";

// OR, use a sandbox: new SandboxConnectionCredentialsProvider({ sandboxId: "xxx" })
const credentials = new ManualConnectionCredentialsProvider(async () => {
  const url = new URL(
    process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details',
    window.location.origin
  );

  let data;
  try {
    const res = await fetch(url.toString());
    data = await res.json();
  } catch (error) {
    console.error('Error fetching connection details:', error);
    throw new Error('Error fetching connection details!');
  }

  return data;
});

const useAgentSession = createUseAgentSession({ credentials });

export default function SinglePageDemo() {
  const agentSession = useAgentSession();
  const [started, setStarted] = useState(false);

  const [chatMessage, setChatMessage] = useState('');

  useEffect(() => {
    if (!started) {
      return;
    }

    agentSession.connect();
    return () => {
      agentSession.disconnect();
    };
  }, [started]);

  return (
    <div>
      <div>
        Statuses: {agentSession.connectionState} / {agentSession.agent?.conversationalState ?? 'N/A'}
      </div>
      <Button variant="primary" onClick={() => setStarted(s => !s)}>
        {agentSession.isConnected ? 'Disconnect' : 'Connect'}
      </Button>

      {agentSession.isConnected ? (
        <div>
          {agentSession.local ? (
            <div>
              <Button onClick={() => agentSession.local.camera?.toggle?.()}>
                {agentSession.local.camera?.enabled ? 'Disable' : 'Enable'} local camera
              </Button>
              <Button onClick={() => agentSession.local?.microphone?.toggle?.()}>
                {agentSession.local.microphone?.enabled ? 'Mute' : 'Un mute'} local microphone
              </Button>
              <div>
                <p>Local microphone sources:</p>
                {agentSession.local.microphone?.devices.list.map(item => (
                  <li
                    key={item.deviceId}
                    onClick={() => agentSession.local.microphone?.devices.changeActive(item.deviceId)}
                    style={{ color: item.deviceId === agentSession?.local.microphone?.devices.activeId ? 'red' : undefined }}
                  >
                    {item.label}
                  </li>
                ))}
              </div>
            </div>
          ) : null}

          {agentSession.local.camera ? (
            <AgentVideoTrack track={agentSession.local.camera} />
          ) : null}
          {agentSession.agent.camera ? (
            <AgentVideoTrack track={agentSession.agent.camera} />
          ) : null}

          <ul>
            {agentSession.messages?.list.map(message => (
              <li key={message.id}>{message.content.text}</li>
            ))}
            <li>
              <input
                type="text"
                value={chatMessage}
                onChange={e => setChatMessage(e.target.value)}
              />
              <Button onClick={() => {
                agentSession.messages?.send(chatMessage);
                setChatMessage('');
              }}>Send</Button>
            </li>
          </ul>
        </div>
      ) : null}

      <AgentStartAudio agentSession={agentSession} />
      <AgentRoomAudioRenderer agent={agentSession.agent} />
    </div>
  );
}
