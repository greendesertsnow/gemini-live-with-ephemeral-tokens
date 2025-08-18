/**
 * Practical Examples of Serialization Safety Integration
 * Real-world examples showing how to integrate the serialization safety system
 * into various Next.js components and patterns.
 */

'use client';

import React, { useState, useEffect, createContext } from 'react';
import { 
  useSerializationCheck, 
  useStateSerializationCheck,
  SerializationWarnings,
  withSerializationCheck 
} from '@/lib/dev-warnings';
import { SerializationErrorBoundary } from '@/components/serialization-error-boundary';
import { 
  SerializableState,
  SerializableContext,
  ToSerializable 
} from '@/lib/serialization-types';
import { 
  detectNonSerializable, 
  makeSerializable, 
  safeStringify 
} from '@/lib/serialization-utils';

// ===== EXAMPLE 1: Safe Component Props =====

interface UserCardProps {
  userId: string;
  name: string;
  preferences: Record<string, string | number | boolean>;
  // Note: Functions like onClick should be handled carefully
  onEdit?: () => void; // Will trigger dev warning but won't break
}

function UserCard(props: UserCardProps) {
  const { userId, name, preferences, onEdit } = props;
  
  // This will warn about onEdit function in development
  useSerializationCheck(props as unknown as Record<string, unknown>, 'UserCard', {
    excludePaths: ['onEdit'] // Skip checking callback props
  });

  return (
    <div className="border rounded p-4">
      <h3>{name}</h3>
      <p>ID: {userId}</p>
      <div>
        <strong>Preferences:</strong>
        <ul>
          {Object.entries(preferences).map(([key, value]) => (
            <li key={key}>{key}: {String(value)}</li>
          ))}
        </ul>
      </div>
      {onEdit && (
        <button onClick={onEdit} className="mt-2 px-3 py-1 bg-blue-500 text-white rounded">
          Edit
        </button>
      )}
    </div>
  );
}

// Wrap with serialization checking HOC
const SafeUserCard = withSerializationCheck(UserCard as unknown as React.ComponentType<Record<string, unknown>>);

// ===== EXAMPLE 2: State Management with Serialization Safety =====

interface AppState {
  user: { id: string; name: string; email: string } | null;
  settings: Record<string, string | number | boolean>;
  notifications: Array<{ id: string; message: string; timestamp: string }>;
  // Note: No functions, Sets, Maps, or other non-serializable types
}

function useAppState() {
  const [state, setState] = useState<SerializableState<AppState>>({
    user: null,
    settings: {},
    notifications: []
  });

  // This will warn if state contains non-serializable values
  useStateSerializationCheck(state, 'AppState');

  const updateUser = (user: AppState['user']) => {
    setState(prev => ({ ...prev, user }));
  };

  const addNotification = (message: string) => {
    setState(prev => ({
      ...prev,
      notifications: [
        ...prev.notifications,
        {
          id: Date.now().toString(),
          message,
          timestamp: new Date().toISOString() // Safe: converted to string
        }
      ]
    }));
  };

  return { state, updateUser, addNotification };
}

// ===== EXAMPLE 3: Context with Serialization Safety =====

interface ThemeContextValue {
  theme: 'light' | 'dark';
  primaryColor: string;
  settings: Record<string, unknown>;
}

const ThemeContext = createContext<SerializableContext<ThemeContextValue> | null>(null);

interface ThemeProviderProps {
  children: React.ReactNode;
  initialTheme?: 'light' | 'dark';
}

export function ThemeProvider({ children, initialTheme = 'light' }: ThemeProviderProps) {
  const [contextValue] = useState<SerializableContext<ThemeContextValue>>({
    theme: initialTheme,
    primaryColor: '#0070f3',
    settings: {}
  } as SerializableContext<ThemeContextValue>);

  // Validate context value is serializable
  useStateSerializationCheck(contextValue, 'ThemeContext');

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

// ===== EXAMPLE 4: Handling External Data with Sets/Maps =====

interface ExternalApiResponse {
  users: Set<string>; // Problematic: Set is not serializable
  roleMapping: Map<string, string>; // Problematic: Map is not serializable
  lastUpdated: Date; // Problematic: Date needs careful handling
  metadata: {
    version: number;
    features: string[];
  };
}

function DataProcessor() {
  const [processedData, setProcessedData] = useState<unknown>(null);
  const [, setRawData] = useState<ExternalApiResponse | null>(null);

  useEffect(() => {
    // Simulate fetching data with non-serializable types
    const fetchData = async () => {
      const response: ExternalApiResponse = {
        users: new Set(['user1', 'user2', 'user3']),
        roleMapping: new Map([
          ['user1', 'admin'],
          ['user2', 'editor'],
          ['user3', 'viewer']
        ]),
        lastUpdated: new Date(),
        metadata: {
          version: 1,
          features: ['auth', 'notifications']
        }
      };
      
      setRawData(response);
      
      // Convert to serializable format
      const safeData = makeSerializable(response);
      
      setProcessedData(safeData);
    };

    fetchData();
  }, []);

  return (
    <SerializationErrorBoundary>
      <div className="p-4">
        <h2>Data Processing Example</h2>
        
        <div>
          {/* Show warnings for non-serializable data - commented out for build compatibility */}
          {/* 
          {rawData ? (
            <SerializationWarnings 
              data={rawData as unknown as Record<string, unknown>} 
              context="Raw API Data"
              className="mb-4"
            />
          ) : null}
          */}
        </div>
        
        {processedData ? (
          <div>
            <h3>Processed Data (Serializable):</h3>
            <pre className="bg-gray-100 p-3 rounded text-sm overflow-auto">
              {JSON.stringify(processedData, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </SerializationErrorBoundary>
  );
}

// ===== EXAMPLE 5: Form Data with File Handling =====

interface FormData {
  title: string;
  description: string;
  tags: string[];
  attachments?: File[]; // Problematic: Files are not serializable
}

function DocumentForm() {
  const [formData, setFormData] = useState<Partial<FormData>>({
    title: '',
    description: '',
    tags: []
  });
  
  const [serializedFormData, setSerializedFormData] = useState<unknown>(null);

  const handleFileChange = (files: File[]) => {
    // Don't store File objects directly - they're not serializable
    const fileInfo = files.map(file => ({
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: new Date(file.lastModified).toISOString()
    }));
    
    setFormData(prev => ({ ...prev, attachments: files as File[] }));
    
    // Create serializable version for state management
    const serializableData = makeSerializable({
      ...formData,
      attachments: fileInfo // Convert files to serializable info
    });
    
    setSerializedFormData(serializableData);
  };

  const handleSubmit = () => {
    // Use the serializable version for state/props
    const { result, issues } = safeStringify(serializedFormData);
    
    if (issues.length > 0) {
      console.warn('Form data serialization issues:', issues);
    }
    
    console.log('Submitting form data:', result);
  };

  return (
    <SerializationErrorBoundary
      fallback={(error, issues, retry) => (
        <div className="bg-red-50 p-4 rounded">
          <h3>Form Error</h3>
          <p>There was a serialization issue with the form data.</p>
          <ul className="mt-2">
            {issues.map((issue, i) => (
              <li key={i} className="text-sm">
                {issue.path}: {(issue as unknown as Record<string, unknown>).reason as string || 'serialization issue'}
              </li>
            ))}
          </ul>
          <button onClick={retry} className="mt-2 px-3 py-1 bg-red-500 text-white rounded">
            Reset Form
          </button>
        </div>
      )}
    >
      <form className="space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
        <div>
          <label className="block text-sm font-medium">Title:</label>
          <input
            type="text"
            value={formData.title || ''}
            onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
            className="mt-1 block w-full border rounded px-3 py-2"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium">Attachments:</label>
          <input
            type="file"
            multiple
            onChange={(e) => handleFileChange(Array.from(e.target.files || []))}
            className="mt-1 block w-full"
          />
        </div>
        
        <SerializationWarnings 
          data={formData} 
          context="Form Data"
        />
        
        <button 
          type="submit"
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Submit
        </button>
      </form>
    </SerializationErrorBoundary>
  );
}

// ===== EXAMPLE 6: WebSocket Message Handling =====

interface WebSocketMessage {
  type: string;
  payload: unknown;
  timestamp: Date; // Will be converted to string
  metadata?: {
    userId: string;
    sessionId: string;
  };
}

function WebSocketClient() {
  const [messages, setMessages] = useState<ToSerializable<WebSocketMessage>[]>([]);
  const [connectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleMessage = (rawMessage: WebSocketMessage) => {
    // Convert to serializable format before storing in state
    const serializableMessage = {
      type: rawMessage.type,
      payload: makeSerializable(rawMessage.payload),
      timestamp: rawMessage.timestamp.toISOString(), // Convert Date to string
      metadata: rawMessage.metadata
    } as ToSerializable<WebSocketMessage>;

    // Validate it's actually serializable
    const issues = detectNonSerializable(serializableMessage);
    if (issues.length > 0) {
      console.error('Message serialization failed:', issues);
      return;
    }

    setMessages(prev => [...prev, serializableMessage]);
  };

  const sendMessage = (type: string, payload: unknown) => {
    const message = {
      type,
      payload: makeSerializable(payload), // Ensure payload is serializable
      timestamp: new Date().toISOString(),
      metadata: {
        userId: 'current-user-id',
        sessionId: 'current-session-id'
      }
    };

    // Validate before sending
    const { result, issues } = safeStringify(message);
    if (issues && issues.length > 0) {
      console.error('Cannot send message - serialization issues:', issues);
      return;
    }

    // Send the message (WebSocket send would go here)
    console.log('Sending message:', result);
  };

  return (
    <div className="p-4">
      <div className="mb-4">
        <span className={`inline-block px-2 py-1 rounded text-sm ${
          connectionStatus === 'connected' ? 'bg-green-100 text-green-800' :
          connectionStatus === 'connecting' ? 'bg-yellow-100 text-yellow-800' :
          'bg-red-100 text-red-800'
        }`}>
          {connectionStatus}
        </span>
      </div>

      <div className="mb-4">
        <button
          onClick={() => sendMessage('test', { message: 'Hello World!' })}
          className="px-3 py-1 bg-blue-500 text-white rounded mr-2"
        >
          Send Test Message
        </button>
        
        <button
          onClick={() => {
            // This will demonstrate the error handling
            const problematicData = {
              message: 'Hello',
              callback: () => console.log('callback'), // Non-serializable
              data: new Set(['a', 'b', 'c']) // Non-serializable
            };
            sendMessage('problem', problematicData);
          }}
          className="px-3 py-1 bg-red-500 text-white rounded"
        >
          Send Problematic Message
        </button>
      </div>

      <div className="border rounded p-3 max-h-64 overflow-auto">
        <h3 className="font-medium mb-2">Messages:</h3>
        {messages.map((msg, index) => (
          <div key={index} className="mb-2 p-2 bg-gray-50 rounded text-sm">
            <strong>{msg.type}</strong> at {msg.timestamp}
            <pre className="mt-1 text-xs">{JSON.stringify(msg.payload, null, 2)}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===== EXAMPLE 7: Integration with Existing Components =====

// Example showing how to retrofit existing components
// This component is commented out to avoid React hooks rule violations
/*
function ExistingComponent({ data, config }: {
  data: unknown;
  config: Record<string, unknown>;
}) {
  // Add serialization checking to existing component
  useSerializationCheck({ data, config }, 'ExistingComponent');

  return <div>Existing component content</div>;
}
*/

// ===== Main Demo Component =====

export function SerializationExamples() {
  const appState = useAppState();

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <h1 className="text-3xl font-bold">Serialization Safety Examples</h1>
      
      <section>
        <h2 className="text-2xl font-semibold mb-4">1. Safe Component Props</h2>
        <SafeUserCard
          userId="123"
          name="John Doe"
          preferences={{ theme: 'dark', notifications: true }}
          onEdit={() => console.log('Edit clicked')}
        />
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-4">2. Data Processing</h2>
        <DataProcessor />
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-4">3. Form with File Handling</h2>
        <DocumentForm />
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-4">4. WebSocket Messages</h2>
        <WebSocketClient />
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-4">5. App State</h2>
        <div className="border rounded p-4">
          <h3 className="font-medium mb-2">Current State:</h3>
          <pre className="text-sm bg-gray-100 p-3 rounded">
            {JSON.stringify(appState.state, null, 2)}
          </pre>
          <button
            onClick={() => appState.addNotification('New notification!')}
            className="mt-2 px-3 py-1 bg-green-500 text-white rounded"
          >
            Add Notification
          </button>
        </div>
      </section>
    </div>
  );
}