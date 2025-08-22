import { useRouter } from 'next/navigation';
import { usePocketBaseAuth } from './pocketbase-context';

export function useAuthRedirect() {
    const router = useRouter();
    const { isAuthenticated, isLoading } = usePocketBaseAuth();

    const redirectToLogin = () => {
        router.push('/login');
    };

    const redirectToHome = () => {
        router.push('/');
    };

    return {
        isAuthenticated,
        isLoading,
        redirectToLogin,
        redirectToHome
    };
}