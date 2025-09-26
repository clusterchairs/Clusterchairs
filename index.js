
document.querySelector('.nav-links a').onclick = function (e) {
  e.preventDefault();
  document.getElementById('auth-modal').style.display = 'flex';
};

// Close modal on close button click
document.querySelector('.close-btn').onclick = function () {
  document.getElementById('auth-modal').style.display = 'none';
};

// Optional: Close modal when clicking outside modal content
document.getElementById('auth-modal').onclick = function (e) {
  if (e.target === this) this.style.display = 'none';
};

