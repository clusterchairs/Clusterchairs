// Function to get the current logged-in user's email from the cookie (Assumes getCookie is in utils.js)
function getUserEmail() {
    return getCookie('userEmail');
}

async function handleAddToCart(product) {
    const userEmail = getUserEmail();
    if (!userEmail) {
        alert('Please log in to add items to your cart.');
        window.location.href = '/login.html';
        return;
    }

    try {
        const HOSTED_BACKEND_URL = "/"; // Use relative path if client is on the same domain

        const response = await fetch(`${HOSTED_BACKEND_URL}cart/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_email: userEmail,
                name: product.name,
                price: product.price,
                img: product.img,
                quantity: 1 // Default to 1 on button click
            })
        });

        const data = await response.json();
        
        if (data.success) {
            showCartPopup(`${product.name} has been added to the cart!`);
            // Update the count by fetching the new cart from the server
            updateCartCount(); 
        } else {
            alert(`Error adding item: ${data.message}`);
        }

    } catch (error) {
        console.error('Error in handleAddToCart:', error);
        alert('An unexpected error occurred while adding to cart.');
    }
}

function showCartPopup(message) {
    const popup = document.getElementById('cart-popup');
    if (!popup) return;
    popup.textContent = message;
    popup.style.display = 'block';
    popup.style.opacity = '1';
    setTimeout(() => {
        popup.style.opacity = '0';
        setTimeout(() => popup.style.display = 'none', 300);
    }, 1800);
}

// MODIFIED: Fetches cart count from the server
async function updateCartCount() {
    const userEmail = getUserEmail();
    const cartCountElem = document.getElementById('cart-count');

    if (!userEmail) {
        if (cartCountElem) cartCountElem.textContent = 0;
        return;
    }

    try {
        const HOSTED_BACKEND_URL = "/";
        // Fetch cart items
        const response = await fetch(`${HOSTED_BACKEND_URL}cart/fetch?email=${userEmail}`);
        const data = await response.json();
        
        if (cartCountElem && data.success) {
            // The count is the number of unique items (rows) in the database
            cartCountElem.textContent = data.cart.length; 
        } else if (cartCountElem) {
            cartCountElem.textContent = 0;
        }
    } catch (error) {
        console.error('Error fetching cart count:', error);
        if (cartCountElem) cartCountElem.textContent = 0;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.add-to-cart-btn').forEach(button => {
        button.addEventListener('click', function () {
            const product = {
                name: this.dataset.name,
                price: this.dataset.price,
                img: this.dataset.img
            };
            handleAddToCart(product);
        });
    });
    updateCartCount();
});