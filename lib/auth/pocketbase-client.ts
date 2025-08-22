import PocketBase from 'pocketbase';

export const pb = new PocketBase(process.env.NEXT_PUBLIC_POCKETBASE_URL);

// Function to set middleware-readable cookie
function setAuthCookie(isAuthenticated: boolean) {
    if (typeof document !== 'undefined') {
        if (isAuthenticated) {
            document.cookie = `pb_auth=true; path=/; max-age=${60 * 60 * 24 * 30}; samesite=strict`;
        } else {
            document.cookie = 'pb_auth=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        }
    }
}

// Auto-refresh auth state and sync cookies
pb.authStore.onChange((token, model) => {
    console.log('PocketBase auth state changed:', {
        token: !!token,
        user: model?.email
    });

    // Update cookie for middleware
    setAuthCookie(!!token && !!model);
});

export interface AuthUser {
    id: string;
    email: string;
    name?: string;
    avatar?: string;
    verified?: boolean;
}

// Auth utilities
export const authHelpers = {
    isAuthenticated: () => pb.authStore.isValid,
    getCurrentUser: (): AuthUser | null => {
        const model = pb.authStore.model;
        if (!model) return null;
        return {
            id: model.id,
            email: model.email as string,
            name: model.name as string,
            avatar: model.avatar as string,
            verified: model.verified as boolean,
        };
    },
    getToken: () => pb.authStore.token,

    async login(email: string, password: string): Promise<AuthUser> {
        const authData = await pb.collection('users').authWithPassword(email, password);
        const record = authData.record;

        // Set cookie immediately after successful login
        setAuthCookie(true);

        return {
            id: record.id,
            email: record.email as string,
            name: record.name as string,
            avatar: record.avatar as string,
            verified: record.verified as boolean,
        };
    },

    logout() {
        pb.authStore.clear();
        setAuthCookie(false);
    }
};