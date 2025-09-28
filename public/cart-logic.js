
function handleAddToCart(product) {
    const isLoggedIn = localStorage.getItem('isLoggedIn');
    if (isLoggedIn !== "true") {
        alert('Please log in to add items to your cart.');
        window.location.href = '/login.html';
        return;
    }
    let cart = JSON.parse(localStorage.getItem('cart')) || [];
    const existingItem = cart.find(item => item.name === product.name);
    if (existingItem) {
        existingItem.quantity++;
    } else {
        cart.push({
            name: product.name,
            price: product.price,
            img: product.img,
            quantity: 1
        });
    }
    localStorage.setItem('cart', JSON.stringify(cart));
    showCartPopup(`${product.name} has been added to the cart!`);
    updateCartCount();
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

function updateCartCount() {
    const cart = JSON.parse(localStorage.getItem('cart')) || [];
    const cartCountElem = document.getElementById('cart-count');
    if (cartCountElem) {
        cartCountElem.textContent = cart.length;
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