// Function to handle the "Add to Cart" button click
function handleAddToCart(product) {
    const token = localStorage.getItem('token'); // Get the token from local storage

    // Check if the user is NOT logged in
    if (!token) {
        // Redirect them to the login page
        alert('Please log in to add items to your cart.');
        window.location.href = 'login.html';
        return;
    }

    // If the user IS logged in, proceed with the cart logic
    let cart = JSON.parse(localStorage.getItem('cart')) || [];
    
    // Find if the item is already in the cart
    const existingItem = cart.find(item => item.name === product.name);

    if (existingItem) {
        existingItem.quantity++;
    } else {
        // Add the new item with a quantity of 1
        cart.push({
            name: product.name,
            price: product.price,
            img: product.img,
            quantity: 1
        });
    }

    localStorage.setItem('cart', JSON.stringify(cart));
    
    // Show a success message
    showCartPopup(`${product.name} has been added to the cart!`);

    // Update the cart count in the navbar
    updateCartCount();
}

// Function to show a temporary pop-up message
function showCartPopup(message) {
    const popup = document.createElement('div');
    popup.id = 'cart-popup';
    popup.textContent = message;
    popup.style.cssText = `
        position: fixed;
        top: 30px;
        right: 30px;
        background: #232f3e;
        color: #fff;
        padding: 16px 32px;
        border-radius: 8px;
        box-shadow: 0 2px 12px rgba(0,0,0,0.15);
        font-size: 1.1em;
        z-index: 9999;
        transition: opacity 0.3s;
        opacity: 1;
    `;
    document.body.appendChild(popup);

    setTimeout(() => {
        popup.style.opacity = '0';
        setTimeout(() => popup.remove(), 300); // Remove the element after the fade out
    }, 1800);
}

// Add event listeners to all "Add to Cart" buttons
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.add-to-cart-btn').forEach(button => {
        button.addEventListener('click', function() {
            const product = {
                name: this.dataset.name,
                price: this.dataset.price,
                img: this.dataset.img
            };
            handleAddToCart(product);
        });
    });

    // Initial cart count update when the page loads
    updateCartCount();
});