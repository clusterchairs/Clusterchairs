// auth.js

// Function to handle the logout logic
function handleLogout() {
    // 1. Remove the token from local storage
    localStorage.removeItem('token');
    
    // 2. Clear the cart from local storage
    localStorage.removeItem('cart'); 

    // 3. Redirect the user to the main index page
    window.location.href = 'index.html';
}

// Function to check login status and update the UI
function checkLoginStatus() {
    const token = localStorage.getItem('token');
    const accountLink = document.getElementById('account-link');
    const logoutLink = document.getElementById('logout-link');

    if (accountLink && logoutLink) {
        if (token) {
            // If a token exists, the user is logged in
            accountLink.style.display = 'none'; // Hide the 'Account & Lists' link
            logoutLink.style.display = 'inline'; // Show the 'Logout' link
        } else {
            // If no token exists, the user is not logged in
            accountLink.style.display = 'inline'; // Show the 'Account & Lists' link
            logoutLink.style.display = 'none'; // Hide the 'Logout' link
        }
    }
}

// Function to update the cart count in the navbar
function updateCartCount() {
    const cart = JSON.parse(localStorage.getItem('cart')) || [];
    const cartCountElement = document.getElementById('cart-count');
    if (cartCountElement) {
        // Calculate the total quantity of all items
        const totalItems = cart.reduce((total, item) => total + (item.quantity || 1), 0);
        cartCountElement.textContent = totalItems;
    }
}

// Run the functions when the document is loaded
document.addEventListener('DOMContentLoaded', () => {
    checkLoginStatus();
    updateCartCount();

    // Attach the logout listener only once
    const logoutLink = document.getElementById('logout-link');
    if (logoutLink) {
        logoutLink.addEventListener('click', handleLogout);
    }
});

// Listen for changes to local storage across tabs to keep the UI in sync
window.addEventListener('storage', () => {
    checkLoginStatus();
    updateCartCount();
});