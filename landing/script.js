const form = document.querySelector("#portfolioForm");
const fullName = document.querySelector("#fullName");
const email = document.querySelector("#email");
const materials = document.querySelector("#materials");
const dropzone = document.querySelector("#dropzone");
const fileList = document.querySelector("#fileList");
const formNote = document.querySelector("#formNote");
const statusPill = document.querySelector("#statusPill");
const submitButton = document.querySelector("#submitButton");
const submitText = document.querySelector("#submitText");
const spotlightCard = document.querySelector(".spotlight-card");
const revealTargets = document.querySelectorAll(".reveal-on-scroll");

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.24 }
);

revealTargets.forEach((target) => revealObserver.observe(target));

spotlightCard?.addEventListener("pointermove", (event) => {
  const rect = spotlightCard.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;

  spotlightCard.style.setProperty("--spotlight-x", `${x}%`);
  spotlightCard.style.setProperty("--spotlight-y", `${y}%`);
});

const formatSize = (bytes) => {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const renderFiles = () => {
  const files = Array.from(materials.files).slice(0, 10);
  fileList.innerHTML = "";

  files.forEach((file) => {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    const size = document.createElement("span");

    name.title = file.name;
    name.textContent = file.name;
    size.textContent = formatSize(file.size);

    item.append(name, size);
    item.style.setProperty("--index", fileList.children.length);
    fileList.appendChild(item);
  });

  statusPill.textContent = files.length ? `${files.length} files` : "Waiting";
};

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-dragging");
  });
});

dropzone.addEventListener("drop", (event) => {
  materials.files = event.dataTransfer.files;
  renderFiles();
});

materials.addEventListener("change", renderFiles);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formNote.className = "form-note";

  if (!fullName.value.trim()) {
    formNote.textContent = "Please enter your full name.";
    formNote.classList.add("is-error");
    fullName.focus();
    return;
  }

  if (!email.checkValidity()) {
    formNote.textContent = "Please enter a valid email address.";
    formNote.classList.add("is-error");
    email.focus();
    return;
  }

  if (!materials.files.length) {
    formNote.textContent = "Please upload at least one resume or portfolio file.";
    formNote.classList.add("is-error");
    return;
  }

  submitButton.disabled = true;
  submitText.textContent = "Uploading";
  statusPill.textContent = "Uploading";

  try {
    const response = await fetch("/api/submissions", {
      method: "POST",
      body: new FormData(form)
    });
    const responseText = await response.text();
    let result;

    try {
      result = responseText ? JSON.parse(responseText) : {};
    } catch {
      throw new Error(
        responseText.trim() ||
          "The server returned an invalid response. Please check that /api/submissions is routed to the Node server."
      );
    }

    if (!response.ok) {
      throw new Error(result.error || "Submission failed. Please try again.");
    }

    statusPill.textContent = "Submitted";
    formNote.innerHTML = "";

    const text = document.createTextNode("Done. Copy this portfolio link and send it to the user: ");
    const link = document.createElement("a");

    link.href = result.portfolioUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = result.portfolioUrl;

    formNote.append(text, link);
    formNote.classList.add("is-success");
  } catch (error) {
    statusPill.textContent = "Failed";
    formNote.textContent = error.message;
    formNote.classList.add("is-error");
  } finally {
    submitButton.disabled = false;
    submitText.textContent = "Generate portfolio link";
  }
});
