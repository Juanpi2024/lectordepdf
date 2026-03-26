// main.js

const chatHistory = document.getElementById('chatHistory');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const sourceCapture = document.getElementById('sourceCapture');
const placeholder = document.getElementById('placeholder');

async function handleSend() {
    const query = userInput.value.trim();
    if (!query) return;

    // Add user message
    addMessage(query, 'user');
    userInput.value = '';

    // Simulate AI thinking
    const aiMessage = addMessage('Analizando manuales y buscando evidencias...', 'ai');

    try {
        const response = await fetch('/api/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        const data = await response.json();

        if (data.error) throw new Error(data.error);

        aiMessage.innerText = data.answer;
        
        if (data.capture) {
            placeholder.style.display = 'none';
            // Use iframe for PDF source or img for images
            if (data.capture.endsWith('.pdf')) {
                sourceCapture.style.display = 'none';
                let pdfFrame = document.getElementById('pdfFrame');
                if (!pdfFrame) {
                    pdfFrame = document.createElement('iframe');
                    pdfFrame.id = 'pdfFrame';
                    pdfFrame.style.width = '100%';
                    pdfFrame.style.height = '100%';
                    pdfFrame.style.border = 'none';
                    document.querySelector('.capture-container').appendChild(pdfFrame);
                }
                pdfFrame.src = data.capture;
                pdfFrame.style.display = 'block';
            } else {
                sourceCapture.src = data.capture;
                sourceCapture.style.display = 'block';
                if (document.getElementById('pdfFrame')) document.getElementById('pdfFrame').style.display = 'none';
            }
        }

    } catch (error) {
        aiMessage.innerText = "Error: " + error.message + ". ¿Está configurado el backend y la API de Google?";
    }
}

function addMessage(text, type) {
    const msg = document.createElement('div');
    msg.className = `message ${type}`;
    msg.innerText = text;
    chatHistory.appendChild(msg);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    return msg;
}

sendBtn.addEventListener('click', handleSend);
userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSend();
});
