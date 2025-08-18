# Serialization Safety Integration Guide

This guide shows how to integrate the comprehensive serialization safety system into your Next.js application to prevent Set/Map serialization issues and other common serialization problems.

## Quick Start

### 1. Enable Development Warnings

Add to your root layout or main App component:

```tsx
// app/layout.tsx
import { installSerializationDevTools } from '@/lib/dev-warnings';

if (typeof window !== 'undefined') {
  installSerializationDevTools();
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

### 2. Wrap Your App with Error Boundary

```tsx
// app/layout.tsx
import { SerializationErrorBoundary } from '@/components/serialization-error-boundary';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SerializationErrorBoundary
          autoFix={true}
          logErrors={true}
          maxRetries={2}
        >
          {children}
        </SerializationErrorBoundary>
      </body>
    </html>
  );
}
```

## Component-Level Integration

### Using the Serialization Check Hook

```tsx
import { useSerializationCheck } from '@/lib/dev-warnings';
import { SerializableProps } from '@/lib/serialization-types';

interface MyComponentProps {
  data: any[];
  onAction: () => void; // This will trigger a warning
  validProp: string;
}

export function MyComponent(props: MyComponentProps) {
  // This will warn about the onAction function in development
  useSerializationCheck(props, 'MyComponent');

  return <div>{/* component content */}</div>;
}
```

### Using TypeScript Types for Prop Safety

```tsx
import { SerializableProps, ValidateSerializableProps } from '@/lib/serialization-types';

// ✅ This will work - all props are serializable
interface GoodProps extends SerializableProps {
  title: string;
  items: Array<{ id: string; name: string }>;
  count: number;
}

// ❌ This will show TypeScript errors for non-serializable props
interface BadProps extends SerializableProps {
  data: Map<string, any>; // Error: Map is not serializable
  callback: () => void;   // Error: Function is not serializable
  date: Date;            // Error: Date needs special handling
}

// Use ValidateSerializableProps to get helpful error messages
type CheckedProps = ValidateSerializableProps<BadProps>;
```

### Higher-Order Component Pattern

```tsx
import { withSerializationCheck, withSerializationErrorBoundary } from '@/lib/dev-warnings';
import { SerializationErrorBoundary } from '@/components/serialization-error-boundary';

// Method 1: HOC for checking
const SafeComponent = withSerializationCheck(MyComponent, {
  logLevel: 'error',
  excludePaths: ['onAction'] // Skip checking callback props
});

// Method 2: HOC for error boundary
const ComponentWithBoundary = withSerializationErrorBoundary(MyComponent, {
  autoFix: true,
  maxRetries: 1
});
```

## State Management Integration

### Safe State Hook

```tsx
import { useStateSerializationCheck } from '@/lib/dev-warnings';
import { SerializableState } from '@/lib/serialization-types';
import { useState } from 'react';

interface AppState {
  user: { id: string; name: string } | null;
  settings: Record<string, string | number | boolean>;
  // Don't include functions, Maps, Sets, etc.
}

export function useAppState() {
  const [state, setState] = useState<SerializableState<AppState>>({
    user: null,
    settings: {}
  });

  // This will warn if state contains non-serializable values
  useStateSerializationCheck(state, 'AppState');

  return [state, setState] as const;
}
```

### Context Safety

```tsx
import { createContext, useContext } from 'react';
import { SerializableContext, SerializableProviderProps } from '@/lib/serialization-types';

interface AppContextValue {
  theme: 'light' | 'dark';
  user: { id: string; name: string } | null;
  settings: Record<string, any>;
}

const AppContext = createContext<SerializableContext<AppContextValue> | null>(null);

export function AppProvider({ children, value }: SerializableProviderProps<AppContextValue>) {
  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}
```

## Next.js Specific Integration

### Page Props Validation

```tsx
import { SerializablePageProps, NextJsSerializable } from '@/lib/serialization-types';
import { detectNonSerializable } from '@/lib/serialization-utils';

interface PageData {
  posts: Array<{ id: string; title: string; content: string }>;
  user: { id: string; name: string };
}

export async function getServerSideProps(): Promise<NextJsSerializable.GetServerSidePropsResult<PageData>> {
  const data = await fetchData();
  
  // Validate data is serializable before returning
  const validation = detectNonSerializable(data);
  if (!validation.isSerializable) {
    console.error('Non-serializable data detected:', validation.issues);
    // Handle the error appropriately
  }

  return {
    props: {
      ...data,
      // Ensure all props are serializable
    }
  };
}

export default function Page(props: SerializablePageProps<PageData>) {
  // TypeScript will ensure props are serializable
  return <div>{/* page content */}</div>;
}
```

### API Route Safety

```tsx
import { NextRequest } from 'next/server';
import { NextJsSerializable } from '@/lib/serialization-types';
import { safeStringify } from '@/lib/serialization-utils';

interface ApiRequestBody {
  action: string;
  data: Record<string, any>;
}

interface ApiResponseData {
  success: boolean;
  result: any;
  timestamp: string;
}

export async function POST(request: NextRequest) {
  const body: NextJsSerializable.ApiRequestBody<ApiRequestBody> = await request.json();
  
  const result = await processRequest(body);
  
  // Ensure response is serializable
  const responseData: NextJsSerializable.ApiResponseBody<ApiResponseData> = {
    data: {
      success: true,
      result,
      timestamp: new Date().toISOString()
    },
    status: 200,
    message: 'Success'
  };

  const { result: serializedData, issues } = safeStringify(responseData);
  
  if (issues.length > 0) {
    console.warn('Serialization issues in API response:', issues);
  }

  return Response.json(responseData);
}
```

## Common Problem Solutions

### Converting Non-Serializable Data

```tsx
import { makeSerializable, detectNonSerializable } from '@/lib/serialization-utils';

// Problem: You have data with Sets and Maps
const problematicData = {
  tags: new Set(['react', 'nextjs', 'typescript']),
  userRoles: new Map([
    ['user1', 'admin'],
    ['user2', 'user']
  ]),
  createdAt: new Date(),
  callback: () => console.log('hello')
};

// Solution 1: Automatic conversion
const safeData = makeSerializable(problematicData, {
  convertSets: true,
  convertMaps: true,
  convertDates: true,
  removeFunctions: true
});

// Solution 2: Manual conversion
const manuallyConvertedData = {
  tags: Array.from(problematicData.tags),
  userRoles: Object.fromEntries(problematicData.userRoles),
  createdAt: problematicData.createdAt.toISOString(),
  // callback removed
};

// Solution 3: Check before using
const validation = detectNonSerializable(problematicData);
if (!validation.isSerializable) {
  console.log('Issues found:', validation.issues);
  // Handle each issue appropriately
}
```

### Real-World Component Example

```tsx
import { useState } from 'react';
import { useSerializationCheck, SerializationWarnings } from '@/lib/dev-warnings';
import { SerializationErrorBoundary } from '@/components/serialization-error-boundary';
import { SerializableProps } from '@/lib/serialization-types';

interface UserProfileProps extends SerializableProps {
  userId: string;
  onSave?: (data: Record<string, any>) => void; // Will trigger warning
  initialData: {
    name: string;
    email: string;
    preferences: Record<string, string | number | boolean>;
  };
}

export function UserProfile(props: UserProfileProps) {
  const { userId, onSave, initialData } = props;
  
  // Check props for serialization issues in development
  useSerializationCheck(props, 'UserProfile', {
    excludePaths: ['onSave'] // Skip callback validation
  });

  const [formData, setFormData] = useState(initialData);
  const [submitData, setSubmitData] = useState<any>(null);

  const handleSubmit = () => {
    // Problematic: might contain non-serializable data
    const dataToSubmit = {
      ...formData,
      timestamp: new Date(), // This will cause issues
      submitCallback: () => console.log('submitted') // This too
    };
    
    setSubmitData(dataToSubmit);
    onSave?.(dataToSubmit);
  };

  return (
    <SerializationErrorBoundary
      onError={(error, errorInfo, issues) => {
        console.log('Caught serialization error:', { error, issues });
      }}
    >
      <div className="user-profile">
        <h2>User Profile</h2>
        
        {/* Show serialization warnings in development */}
        <SerializationWarnings 
          data={submitData} 
          context="Submit Data"
          showInProduction={false}
        />
        
        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
          <input
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
          />
          <button type="submit">Save</button>
        </form>
      </div>
    </SerializationErrorBoundary>
  );
}
```

## Development Tools

### Console Helpers

The system automatically installs console helpers in development:

```javascript
// In browser console:

// Check any value for serialization issues
__checkSerialization(myData, 'My Data');

// Check component props
__checkSerialization(componentRef.current.props, 'Component Props');

// Check React state
__checkSerialization(useState[0], 'Component State');
```

### Manual Validation

```tsx
import { 
  detectNonSerializable, 
  safeStringify, 
  logSerializationIssues 
} from '@/lib/serialization-utils';

// Check if data is serializable
const result = detectNonSerializable(myData);
if (!result.isSerializable) {
  console.log('Issues:', result.issues);
}

// Try to stringify safely
const { result: json, issues } = safeStringify(myData, { 
  space: 2,
  includeWarnings: true 
});

// Log issues with helpful suggestions
logSerializationIssues(myData, 'My Component Data', { 
  logLevel: 'error' 
});
```

## Configuration

### Global Configuration

```tsx
// Set up in your app root
import { configureDevWarnings } from '@/lib/dev-warnings';

configureDevWarnings({
  enabled: process.env.NODE_ENV === 'development',
  logLevel: 'warn',
  checkProps: true,
  checkState: true,
  checkContext: true,
  excludePaths: ['onAction', 'callback', 'onClick'],
  includeStackTrace: true
});
```

### Component-Level Configuration

```tsx
// Per-component configuration
<SerializationErrorBoundary
  autoFix={true}
  maxRetries={2}
  showDetails={process.env.NODE_ENV === 'development'}
  resetOnPropsChange={true}
  onError={(error, errorInfo, issues) => {
    // Custom error handling
    analytics.track('serialization_error', {
      component: errorInfo.componentStack,
      issues: issues.length
    });
  }}
>
  <MyComponent />
</SerializationErrorBoundary>
```

## Best Practices

### 1. Use TypeScript Types Early

```tsx
import { SerializableProps } from '@/lib/serialization-types';

// Define your interfaces to extend SerializableProps
interface ComponentProps extends SerializableProps<{
  title: string;
  data: Array<{ id: string; name: string }>;
}> {}
```

### 2. Convert Data at Boundaries

```tsx
// Convert at component boundaries, not deep inside
function DataProvider({ children }) {
  const rawData = useRawData(); // Might contain Sets/Maps
  const safeData = useMemo(() => makeSerializable(rawData), [rawData]);
  
  return (
    <DataContext.Provider value={safeData}>
      {children}
    </DataContext.Provider>
  );
}
```

### 3. Handle Server-Side Data

```tsx
// In getServerSideProps or API routes
export async function getServerSideProps() {
  const data = await database.query(); // Might have Dates, etc.
  
  return {
    props: {
      data: makeSerializable(data, {
        convertDates: true,
        convertMaps: true,
        convertSets: true
      })
    }
  };
}
```

### 4. Use Error Boundaries Strategically

```tsx
// Wrap at page level for broad coverage
export default function Page() {
  return (
    <SerializationErrorBoundary fallback={<ErrorPage />}>
      <PageContent />
    </SerializationErrorBoundary>
  );
}

// Or wrap individual risky components
function RiskyDataComponent({ complexData }) {
  return (
    <SerializationErrorBoundary
      autoFix={true}
      fallback={(error, issues, retry) => (
        <div>
          <p>Data serialization failed</p>
          <button onClick={retry}>Try Again</button>
        </div>
      )}
    >
      <ComplexDataViewer data={complexData} />
    </SerializationErrorBoundary>
  );
}
```

This system provides comprehensive protection against serialization issues while maintaining excellent developer experience and providing clear guidance when problems occur.