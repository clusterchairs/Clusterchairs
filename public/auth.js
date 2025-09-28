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
    const isLoggedIn = localStorage.getItem('isLoggedIn');
    const accountLink = document.getElementById('account-link');
    const logoutLink = document.getElementById('logout-link');

    if (accountLink && logoutLink) {
        if (isLoggedIn === "true") {
            accountLink.style.display = 'none';
            logoutLink.style.display = 'inline';
        } else {
            accountLink.style.display = 'inline';
            logoutLink.style.display = 'none';
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
document.addEventListener("DOMContentLoaded", () => {
    const accountLink = document.getElementById("account-link");
    const logoutLink = document.getElementById("logout-link");

    if (localStorage.getItem("isLoggedIn") === "true") {
        accountLink.textContent = localStorage.getItem("userEmail");
        logoutLink.style.display = "inline-block";

        logoutLink.addEventListener("click", () => {
            localStorage.removeItem("isLoggedIn");
            localStorage.removeItem("userEmail");
            window.location.href = "/login.html";
        });
    }
});


// Listen for changes to local storage across tabs to keep the UI in sync
window.addEventListener('storage', () => {
    checkLoginStatus();
    updateCartCount();
});