import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import styles from './Navbar.module.css';

export function Navbar() {
    const navigate = useNavigate();
    const location = useLocation();
    const { user, signOut } = useAuth();

    // Don't show navbar on presenter/viewer pages (full screen)
    const hideNavbar = location.pathname.startsWith('/present') ||
        location.pathname.startsWith('/view');

    if (hideNavbar) return null;

    return (
        <nav className={styles.navbar}>
            <div className={styles.left}>
                <button className={styles.logo} onClick={() => navigate('/')}>
                    SlideViewer
                </button>
            </div>

            <div className={styles.right}>
                {user ? (
                    <>
                        <span className={styles.email}>{user.email}</span>
                        <button className={styles.navButton} onClick={signOut}>
                            Sign out
                        </button>
                    </>
                ) : (
                    <span className={styles.guest}>Guest</span>
                )}
            </div>
        </nav>
    );
}
