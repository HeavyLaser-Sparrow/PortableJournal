"use strict"; // Enforce stricter parsing and error handling

document.addEventListener("DOMContentLoaded", async () => {
    // --- Get DOM Elements ---
    const entryForm = document.getElementById("entryForm");
    const titleInput = document.getElementById("title");
    const contentInput = document.getElementById("content");
    const saveEntryBtn = document.getElementById("saveEntryBtn");
    const cancelEditBtn = document.getElementById("cancelEditBtn");
    const editingEntryIdInput = document.getElementById("editingEntryId"); // Use hidden input

    const entriesList = document.getElementById("entriesList");

    const entryDetailsCard = document.getElementById("entryDetailsCard");
    const detailTitle = document.getElementById("detailTitle");
    const detailDate = document.getElementById("detailDate");
    const detailContent = document.getElementById("detailContent");
    const deleteBtn = document.getElementById("deleteBtn");
    const editBtn = document.getElementById("editBtn"); // Button to initiate edit from detail view
    const closeDetailBtnTop = document.getElementById("closeDetailBtnTop");
    const closeDetailBtnBottom = document.getElementById("closeDetailBtnBottom");

    const exportBtn = document.getElementById("exportBtn");
    const importFile = document.getElementById("importFile");
    const importBtn = document.getElementById("importBtn");

    const lessonsInput = document.getElementById("lessons");
    const exercisesInput = document.getElementById("exercises");
    const labsInput = document.getElementById("labs");
    const addMinutesBtn = document.getElementById("addMinutesBtn");
    const minutesLeftSpan = document.getElementById("minutesLeft");
    const currentSongSpan = document.getElementById("currentSong");
    const playBtn = document.getElementById("playBtn");
    const pauseBtn = document.getElementById("pauseBtn");
    const resumeBtn = document.getElementById("resumeBtn");
    const stopBtn = document.getElementById("stopBtn");
    const playbackModeSelect = document.getElementById("playbackMode");
    const playlistFolderInput = document.getElementById("playlistFolder");
    const audioPlayer = document.getElementById("audioPlayer");

    const notificationBar = document.getElementById("notification-bar");
    const notificationMessage = document.getElementById("notification-message");

    // --- Global App State ---
    let db;
    let encryptionKey;
    // editingEntryId is now stored in the hidden input: editingEntryIdInput.value

    // --- Music Motivator State ---
    let minutesBank = 0;
    let currentSongIndex = -1;
    let songList = [];
    let isPlaying = false;
    let isPaused = false;
    let lastPlayedShuffleIndex = -1; // For better shuffle
    let updateTimerInterval;

    // --- Utility Functions ---
    const buf2hex = buffer => Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
    const hex2buf = hex => {
        const bytes = new Uint8Array(hex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) ?? []);
        return bytes.buffer;
    };
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // --- Notification Bar ---
    function showNotification(message, type = 'info') { // type: success, info, warning, danger
        notificationMessage.textContent = message;
        notificationBar.className = `alert alert-${type}`; // Use Bootstrap alert classes
        notificationBar.style.display = 'block';
        // Auto-hide after 5 seconds
        setTimeout(hideNotification, 5000);
    }

    function hideNotification() {
        notificationBar.style.display = 'none';
    }
    // Make hideNotification globally accessible for the inline onclick
    window.hideNotification = hideNotification;


    // --- Storage Availability Check ---
    function isLocalStorageAvailable() {
        try {
            const test = '__storage_test__';
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            return true;
        } catch (e) {
            return false;
        }
    }

    if (!isLocalStorageAvailable()) {
        showNotification("LocalStorage is not available. Key and settings cannot be saved.", "danger");
        // Optionally disable features that rely on localStorage
        exportBtn.disabled = true;
        importBtn.disabled = true;
        addMinutesBtn.disabled = true;
        // ... disable other relevant buttons
    }

    // --- Crypto Functions ---
    const ALGO = { name: "AES-GCM", length: 256 };
    const IV_LENGTH = 12; // Recommended 12 bytes for GCM

    async function getKey() {
        if (!isLocalStorageAvailable()) return null; // Can't get key if LS is disabled

        let keyHex = localStorage.getItem("journalKey");
        try {
            if (keyHex) {
                const keyBuf = hex2buf(keyHex);
                return await crypto.subtle.importKey("raw", keyBuf, ALGO, true, ["encrypt", "decrypt"]);
            } else {
                const key = await crypto.subtle.generateKey(ALGO, true, ["encrypt", "decrypt"]);
                const rawKey = await crypto.subtle.exportKey("raw", key);
                localStorage.setItem("journalKey", buf2hex(rawKey));
                showNotification("New encryption key generated and saved.", "info");
                return key;
            }
        } catch (error) {
            console.error("Error getting/generating key:", error);
            showNotification("Error handling encryption key. Check console.", "danger");
            localStorage.removeItem("journalKey"); // Remove potentially corrupted key
            return null;
        }
    }

    async function encryptText(plainText, key) {
        if (!key) throw new Error("Encryption key is not available.");
        const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
        const data = encoder.encode(plainText);
        const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
        return buf2hex(iv.buffer) + buf2hex(encrypted);
    }

    async function decryptText(cipherHex, key) {
        if (!key) throw new Error("Decryption key is not available.");
        if (cipherHex.length < IV_LENGTH * 2) throw new Error("Invalid ciphertext (too short).");

        try {
            const ivHex = cipherHex.slice(0, IV_LENGTH * 2);
            const ctHex = cipherHex.slice(IV_LENGTH * 2);
            const iv = new Uint8Array(hex2buf(ivHex));
            const ciphertext = hex2buf(ctHex);
            const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
            return decoder.decode(decrypted);
        } catch (error) {
            console.error("Decryption failed:", error);
            // Don't re-throw immediately, let the caller decide based on context
            // For example, showEntryDetail might show "[Decryption Failed]"
            return null; // Indicate failure
        }
    }

    // --- IndexedDB Functions ---
    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open("JournalDB", 1); // Version 1
            request.onerror = e => {
                console.error("IndexedDB error:", request.error);
                reject(`Database error: ${request.error}`);
            };
            request.onsuccess = e => {
                db = e.target.result;
                resolve(db);
            };
            request.onupgradeneeded = e => {
                db = e.target.result;
                if (!db.objectStoreNames.contains("entries")) {
                    const store = db.createObjectStore("entries", { keyPath: "id", autoIncrement: true });
                    // Add index for sorting/searching if needed, title doesn't need to be unique
                    store.createIndex("date", "date", { unique: false });
                    console.log("Entries object store created.");
                }
                 // Add future upgrades here inside checks like: if (e.oldVersion < 2) { ... }
            };
        });
    }

    function dbOperation(storeName, mode, operation, data) {
        return new Promise((resolve, reject) => {
            if (!db) return reject("Database not initialized.");
            try {
                const tx = db.transaction(storeName, mode);
                const store = tx.objectStore(storeName);
                const request = operation(store, data);

                request.onsuccess = (event) => resolve(request.result || event.target.result); // event.target.result for getAll/get
                request.onerror = () => {
                    console.error(`DB operation error (${mode} on ${storeName}):`, request.error);
                    reject(`Error performing operation: ${request.error}`);
                };
                tx.oncomplete = () => {}; // Often not needed for simple ops
                tx.onerror = () => { // Catch transaction-level errors
                    console.error(`DB transaction error (${mode} on ${storeName}):`, tx.error);
                    reject(`Transaction error: ${tx.error}`);
                 };

            } catch (error) {
                console.error("Error starting DB transaction:", error);
                reject(`Failed to start transaction: ${error}`);
            }
        });
    }

    const addEntryToDB = (entry) => dbOperation("entries", "readwrite", (store, data) => store.add(data), entry);
    const updateEntryInDB = (entry) => dbOperation("entries", "readwrite", (store, data) => store.put(data), entry); // PUT handles both add/update based on key
    const getAllEntries = () => dbOperation("entries", "readonly", (store) => store.getAll());
    const getEntry = (id) => dbOperation("entries", "readonly", (store, data) => store.get(data), Number(id));
    const deleteEntry = (id) => dbOperation("entries", "readwrite", (store, data) => store.delete(data), Number(id));
    const clearEntries = () => dbOperation("entries", "readwrite", (store) => store.clear());

    // --- Journal Functions ---
    async function loadEntries() {
        try {
            const entries = await getAllEntries();
            entriesList.innerHTML = ""; // Clear current list
            if (!entries || entries.length === 0) {
                entriesList.innerHTML = "<li class='list-group-item'>No entries yet. Add one above!</li>";
                return;
            }
            // Sort by date, newest first
            entries.sort((a, b) => new Date(b.date) - new Date(a.date));

            entries.forEach(entry => {
                const li = document.createElement("li");
                li.className = "list-group-item entry-item";
                li.dataset.id = entry.id;
                // Basic sanitization for title display (prevent injecting HTML)
                const safeTitle = entry.title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
                li.innerHTML = `<strong>${safeTitle}</strong> <br><small>${new Date(entry.date).toLocaleString()}</small>`;
                li.addEventListener("click", () => showEntryDetail(entry.id));
                entriesList.appendChild(li);
            });
        } catch (error) {
            console.error("Error loading entries:", error);
            showNotification("Could not load journal entries. See console.", "danger");
            entriesList.innerHTML = "<li class='list-group-item text-danger'>Error loading entries.</li>";
        }
    }

    async function showEntryDetail(id) {
        try {
            const entry = await getEntry(id);
            if (!entry) {
                 showNotification("Entry not found.", "warning");
                 return;
            }

            const decryptedContent = await decryptText(entry.content, encryptionKey);

            if (decryptedContent === null) {
                // Decryption failed
                showNotification("Failed to decrypt entry. Key might be wrong or data corrupted.", "danger");
                detailTitle.textContent = entry.title;
                detailDate.textContent = new Date(entry.date).toLocaleString();
                 // Use DOMPurify if available, otherwise basic text or risk injection if markdown allows scripts
                detailContent.innerHTML = "<p class='text-danger'>[Could not decrypt content]</p>";
            } else {
                 // Render Markdown content safely
                 // Ensure marked library is loaded
                 if (typeof marked === 'function') {
                    // Configure marked for safety (optional, default is relatively safe)
                     marked.setOptions({
                         breaks: true, // Convert GFM line breaks to <br>
                         sanitize: false, // DEPRECATED in newer marked. Use a dedicated sanitizer if needed.
                         // Use DOMPurify *after* marked if complex HTML/scripts in Markdown are a concern
                     });
                    detailContent.innerHTML = marked.parse(decryptedContent);
                 } else {
                     // Fallback to preformatted text if marked.js failed to load
                     detailContent.innerHTML = `<pre>${decryptedContent.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
                 }

                detailTitle.textContent = entry.title;
                detailDate.textContent = new Date(entry.date).toLocaleString();
            }

            entryDetailsCard.dataset.id = id; // Store ID on the card itself
            entryDetailsCard.style.display = "block";
            entryForm.style.display = "none"; // Hide form when viewing details
        } catch (error) {
            console.error("Error showing entry detail:", error);
            showNotification("Could not display entry details. See console.", "danger");
        }
    }

    function closeEntryDetail() {
        entryDetailsCard.style.display = "none";
        entryDetailsCard.dataset.id = ''; // Clear stored ID
        entryForm.style.display = "block"; // Show form again
    }

    async function loadEntryForEdit(id) {
        try {
            const entry = await getEntry(id);
            if (!entry) {
                 showNotification("Entry not found for editing.", "warning");
                 return;
            }
            const decryptedContent = await decryptText(entry.content, encryptionKey);
            if (decryptedContent === null) {
                 showNotification("Cannot edit: Failed to decrypt entry content.", "danger");
                 return;
            }

            titleInput.value = entry.title;
            contentInput.value = decryptedContent;
            editingEntryIdInput.value = id; // Set the hidden input value
            saveEntryBtn.textContent = 'Update Entry';
            cancelEditBtn.style.display = 'inline-block'; // Show cancel button
            entryDetailsCard.style.display = "none"; // Hide details view
            entryForm.style.display = "block"; // Ensure form is visible
            titleInput.focus(); // Focus on the title field
        } catch (error) {
            console.error("Error loading entry for edit:", error);
             showNotification("Could not load entry for editing. See console.", "danger");
        }
    }

    function resetForm() {
        entryForm.reset(); // Resets title, content
        editingEntryIdInput.value = ''; // Clear hidden ID
        saveEntryBtn.textContent = 'Save Entry';
        cancelEditBtn.style.display = 'none';
    }

    // Handle Form Submission (Add/Update)
    entryForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!encryptionKey) {
            showNotification("Cannot save: Encryption key not available.", "danger");
            return;
        }

        const title = titleInput.value.trim();
        const content = contentInput.value.trim(); // Keep original Markdown
        const currentId = editingEntryIdInput.value ? Number(editingEntryIdInput.value) : null;

        if (!title || !content) {
            showNotification("Title and Content cannot be empty.", "warning");
            return;
        }

        try {
            const encryptedContent = await encryptText(content, encryptionKey);
            const entryData = {
                title,
                content: encryptedContent,
                date: new Date().toISOString() // Always update date on save/update
            };

            if (currentId) {
                // Update existing entry
                entryData.id = currentId;
                await updateEntryInDB(entryData);
                showNotification("Entry updated successfully!", "success");
            } else {
                // Add new entry
                await addEntryToDB(entryData);
                showNotification("Entry saved successfully!", "success");
            }
            resetForm();
            loadEntries(); // Refresh the list
        } catch (error) {
            console.error("Error saving/updating entry:", error);
             showNotification(`Error saving entry: ${error.message || error}`, "danger");
        }
    });

    // Cancel Edit Button
    cancelEditBtn.addEventListener("click", () => {
        resetForm();
    });

    // Delete Button (in detail view)
    deleteBtn.addEventListener("click", async () => {
        const id = entryDetailsCard.dataset.id;
        if (!id) return;

        if (confirm("Are you sure you want to delete this entry? This cannot be undone.")) {
            try {
                await deleteEntry(id);
                showNotification("Entry deleted.", "success");
                closeEntryDetail();
                loadEntries(); // Refresh list
            } catch (error) {
                console.error("Error deleting entry:", error);
                 showNotification(`Error deleting entry: ${error.message || error}`, "danger");
            }
        }
    });

    // Edit Button (in detail view)
    editBtn.addEventListener("click", () => {
        const id = entryDetailsCard.dataset.id;
        if (id) {
            loadEntryForEdit(id);
        }
    });

    // Close Buttons (in detail view)
    closeDetailBtnTop.addEventListener("click", closeEntryDetail);
    closeDetailBtnBottom.addEventListener("click", closeEntryDetail);

    // --- Import/Export Functions ---
    exportBtn.addEventListener("click", async () => {
        if (!isLocalStorageAvailable() || !encryptionKey) {
            showNotification("Cannot export: Key is missing or storage unavailable.", "warning");
            return;
        }
        try {
            const entries = await getAllEntries();
            const backup = {
                key: localStorage.getItem("journalKey"), // Include the key
                entries: entries || [],
                // Optionally backup music progress too
                musicProgress: JSON.parse(localStorage.getItem('musicProgress') || '{}')
            };
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `journal_backup_${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showNotification("Data export started.", "info");
        } catch (error) {
            console.error("Export error:", error);
             showNotification(`Export failed: ${error.message || error}`, "danger");
        }
    });

    importBtn.addEventListener("click", () => {
        if (!isLocalStorageAvailable()) {
             showNotification("Cannot import: LocalStorage unavailable.", "danger");
             return;
        }
        if (!importFile.files.length) {
             showNotification("Please select a backup file to import.", "warning");
             return;
        }
        const file = importFile.files[0];
        const reader = new FileReader();

        reader.onload = async e => {
            try {
                const backup = JSON.parse(e.target.result);
                if (!backup.key || !backup.entries || typeof backup.key !== 'string') {
                    throw new Error("Invalid or incomplete backup file structure.");
                }

                if (!confirm("Importing will overwrite ALL current entries and the encryption key. Are you sure?")) {
                    importFile.value = ''; // Reset file input
                    return;
                }

                // Import Key
                localStorage.setItem("journalKey", backup.key);
                encryptionKey = await getKey(); // Reload the imported key
                 if (!encryptionKey) {
                     throw new Error("Imported key is invalid or could not be processed.");
                 }

                // Import Entries (Clear first, then add)
                await clearEntries();
                // Use Promise.all for potentially faster imports if many entries
                await Promise.all(backup.entries.map(entry => {
                    // Basic validation before adding
                    if (entry && entry.title && entry.content && entry.date) {
                        // Don't re-encrypt, assume content is already encrypted with the imported key
                        return addEntryToDB(entry);
                    } else {
                         console.warn("Skipping invalid entry during import:", entry);
                         return Promise.resolve(); // Skip invalid entries
                    }
                }));

                // Import Music Progress (Optional)
                if (backup.musicProgress) {
                     localStorage.setItem('musicProgress', JSON.stringify(backup.musicProgress));
                     loadMusicProgress(); // Reload music state
                }

                showNotification("Data imported successfully! Entries refreshed.", "success");
                loadEntries(); // Refresh list
                resetForm(); // Clear form
                closeEntryDetail(); // Close detail view if open
                importFile.value = ''; // Reset file input

            } catch (err) {
                console.error("Import error:", err);
                 showNotification(`Error importing backup: ${err.message || err}`, "danger");
                // Attempt to restore previous key if import failed badly? Maybe too complex.
                encryptionKey = await getKey(); // Try to reload original key if possible
                 importFile.value = ''; // Reset file input
            }
        };

        reader.onerror = () => {
             showNotification("Failed to read the selected file.", "danger");
             importFile.value = ''; // Reset file input
        };

        reader.readAsText(file);
    });

    // --- Music Motivator Functions ---
    function calculateMinutes(lessons, exercises, labs) {
        return (lessons * 5) + (exercises * 10) + (labs * 20);
    }

    function updateMinutesDisplay() {
        minutesLeftSpan.textContent = Math.floor(minutesBank);
        // Enable/disable play button based on minutes *and* if a playlist is loaded
        playBtn.disabled = minutesBank <= 0 || songList.length === 0;
    }

    function updateSongDisplay() {
        if (currentSongIndex >= 0 && currentSongIndex < songList.length) {
            currentSongSpan.textContent = songList[currentSongIndex].name;
        } else {
            currentSongSpan.textContent = 'None';
        }
    }

    function updatePlayButtonStates() {
        const hasSongs = songList.length > 0;
        const canPlay = minutesBank > 0 && hasSongs;

        playBtn.disabled = isPlaying || !canPlay;
        pauseBtn.disabled = !isPlaying || isPaused;
        resumeBtn.disabled = !isPlaying || !isPaused || !canPlay; // Can't resume if no time left
        stopBtn.disabled = !isPlaying;
    }

    function saveMusicProgress() {
        if (!isLocalStorageAvailable()) return;
        const musicProgress = {
            minutesBank: minutesBank,
            // No need to save totalLessons etc, they are implicit in minutesBank
            currentSongIndex: currentSongIndex,
            lastPlayedShuffleIndex: lastPlayedShuffleIndex,
            playbackMode: playbackModeSelect.value,
            audioCurrentTime: audioPlayer.currentTime // Save current position
        };
        localStorage.setItem('musicProgress', JSON.stringify(musicProgress));
    }

    function loadMusicProgress() {
        if (!isLocalStorageAvailable()) return;
        const savedProgress = localStorage.getItem('musicProgress');
        if (savedProgress) {
            try {
                const progress = JSON.parse(savedProgress);
                minutesBank = progress.minutesBank || 0;
                // Don't automatically load index/time if page was reloaded while playing was stopped
                // currentSongIndex = progress.currentSongIndex ?? -1;
                // audioPlayer.currentTime = progress.audioCurrentTime || 0; // Restore position
                lastPlayedShuffleIndex = progress.lastPlayedShuffleIndex ?? -1;
                playbackModeSelect.value = progress.playbackMode || 'normal';
                updateMinutesDisplay();
                updateSongDisplay(); // Update display even if index isn't fully loaded yet
                updatePlayButtonStates();
            } catch (error) {
                console.error("Error loading music progress:", error);
                localStorage.removeItem('musicProgress'); // Clear corrupted data
            }
        }
    }

    addMinutesBtn.addEventListener('click', () => {
        const lessons = parseInt(lessonsInput.value) || 0;
        const exercises = parseInt(exercisesInput.value) || 0;
        const labs = parseInt(labsInput.value) || 0;

        if (lessons < 0 || exercises < 0 || labs < 0) {
            showNotification("Cannot add negative values.", "warning");
            return;
        }

        const minutesToAdd = calculateMinutes(lessons, exercises, labs);

        if (minutesToAdd > 0) {
            minutesBank += minutesToAdd;
            updateMinutesDisplay();
            saveMusicProgress();
            showNotification(`${minutesToAdd} minute(s) added. Total: ${Math.floor(minutesBank)}`, "success");
            // Reset input fields
            lessonsInput.value = 0;
            exercisesInput.value = 0;
            labsInput.value = 0;
        } else {
             showNotification("No time added (all inputs were zero).", "info");
        }
    });

    playlistFolderInput.addEventListener('change', (event) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        // Revoke old object URLs to prevent memory leaks
        songList.forEach(song => URL.revokeObjectURL(song.url));
        songList = [];
        currentSongIndex = -1; // Reset index

        // Filter and sort files (optional, but nice)
        const audioFiles = Array.from(files)
                               .filter(file => file.type.startsWith('audio/'))
                               .sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically

        audioFiles.forEach(file => {
             songList.push({ name: file.name, url: URL.createObjectURL(file), file: file /* keep ref if needed */ });
        });


        if (songList.length > 0) {
            showNotification(`Loaded ${songList.length} audio files.`, "info");
            // Do not automatically set currentSongIndex to 0 here
            // Let playSong handle the initial selection based on mode
        } else {
            showNotification('No compatible audio files found in the selected folder.', "warning");
        }
        updateSongDisplay();
        updatePlayButtonStates(); // Update buttons now that playlist status changed
         // Clear the input value so the 'change' event fires even if the same folder is selected again
         playlistFolderInput.value = '';
    });

    function selectNextSong() {
        const mode = playbackModeSelect.value;
        const numSongs = songList.length;
        if (numSongs === 0) return -1; // No songs

        let nextIndex = currentSongIndex;

        switch (mode) {
            case 'shuffle':
                if (numSongs <= 1) {
                    nextIndex = 0;
                } else {
                    do {
                        nextIndex = Math.floor(Math.random() * numSongs);
                    } while (nextIndex === lastPlayedShuffleIndex && numSongs > 1); // Avoid immediate repeat in shuffle
                    lastPlayedShuffleIndex = nextIndex;
                }
                break;
            case 'repeat':
                // Stay on the current index (handled by simply restarting the song)
                 nextIndex = currentSongIndex;
                break;
            case 'repeat_all':
                 nextIndex = (currentSongIndex + 1) % numSongs;
                 break;
            case 'normal':
            default:
                nextIndex++;
                // Stop if we reached the end in normal mode
                if (nextIndex >= numSongs) {
                    return -1; // Signal to stop playback
                }
                break;
        }
        return nextIndex;
    }

    function playSong(indexToPlay) {
        if (songList.length === 0) {
            showNotification("No playlist loaded. Select a folder first.", "warning");
            playlistFolderInput.click(); // Prompt user to select folder
            return;
        }
         if (minutesBank <= 0 && !isPlaying) { // Allow finishing current song if time runs out mid-song
            showNotification("Not enough minutes to start music.", "warning");
            stopMusic(); // Ensure stopped state
            return;
         }

        // Determine the index
        if (typeof indexToPlay === 'number' && indexToPlay >= 0 && indexToPlay < songList.length) {
            currentSongIndex = indexToPlay;
        } else {
            // If no specific index, figure it out based on state/mode
            if (currentSongIndex < 0) { // If nothing selected yet, start based on mode
                 const firstIndex = selectNextSong(); // Get initial index (0 for normal/repeat, random for shuffle)
                 if (firstIndex === -1) return; // Should only happen if songList is empty, checked above
                 currentSongIndex = firstIndex;
            }
             // Otherwise, keep the currentSongIndex (e.g., for resume)
        }


        const currentSong = songList[currentSongIndex];
        if (!currentSong) {
             console.error("Invalid currentSongIndex:", currentSongIndex);
             stopMusic();
             return;
        }

        try {
             // Only set src if it's different or player is not initialized
             // This avoids restarting the song on resume if src is already set
             if (audioPlayer.currentSrc !== currentSong.url) {
                audioPlayer.src = currentSong.url;
             }

            audioPlayer.play()
                .then(() => {
                    isPlaying = true;
                    isPaused = false;
                    updateSongDisplay();
                    updatePlayButtonStates();
                    startTimer();
                })
                .catch(error => {
                    console.error("Audio playback error:", error);
                    showNotification(`Error playing ${currentSong.name}: ${error.message}`, "danger");
                    // Maybe try next song automatically? Or just stop.
                    stopMusic();
                });
        } catch (error) {
             console.error("Error setting up audio playback:", error);
             showNotification("An unexpected error occurred during playback setup.", "danger");
             stopMusic();
        }
    }

    function resumePlayback() {
         if (isPlaying && isPaused) {
            if (minutesBank <= 0) {
                 showNotification("Cannot resume: No time left.", "warning");
                 stopMusic();
                 return;
            }
             audioPlayer.play().then(() => {
                 isPaused = false;
                 updatePlayButtonStates();
                 startTimer(); // Restart timer if it was stopped on pause
             }).catch(error => {
                console.error("Audio resume error:", error);
                showNotification(`Error resuming playback: ${error.message}`, "danger");
                stopMusic();
             });
         } else if (!isPlaying && songList.length > 0) {
             // If stopped but a song is selected, treat resume as play
             playSong(currentSongIndex);
         }
    }

    playBtn.addEventListener('click', () => playSong()); // Start playing (finds first song)
    resumeBtn.addEventListener('click', resumePlayback);

    pauseBtn.addEventListener('click', () => {
        if (isPlaying && !isPaused) {
            audioPlayer.pause();
            isPaused = true;
            updatePlayButtonStates();
            clearInterval(updateTimerInterval); // Stop timer while paused
            saveMusicProgress(); // Save state including current time
        }
    });

    function stopMusic() {
        audioPlayer.pause();
        audioPlayer.currentTime = 0;
        isPlaying = false;
        isPaused = false;
        // currentSongIndex = -1; // debatable - keep index for next play, or reset? Keep for now.
        updateSongDisplay(); // Update display to show current/last song but not playing
        updatePlayButtonStates();
        clearInterval(updateTimerInterval);
        saveMusicProgress(); // Save stopped state
    }
    stopBtn.addEventListener('click', stopMusic);

    audioPlayer.addEventListener('ended', () => {
        // Song finished naturally
        const nextIndex = selectNextSong();
        saveMusicProgress(); // Save progress before potentially changing song

        if (nextIndex === -1) {
            // Reached end of playlist in 'normal' mode or error
            showNotification("Playlist finished.", "info");
            stopMusic();
        } else if (playbackModeSelect.value === 'repeat') {
             // Replay the current song
             audioPlayer.currentTime = 0;
             playSong(currentSongIndex); // Re-trigger play logic for the same index
        } else {
             // Play the next determined song
             playSong(nextIndex);
        }
    });

    // Handle errors on the audio element itself
    audioPlayer.addEventListener('error', (e) => {
        console.error("Audio Element Error:", audioPlayer.error, e);
        let message = "An unknown audio error occurred.";
        if (audioPlayer.error) {
            switch (audioPlayer.error.code) {
                case MediaError.MEDIA_ERR_ABORTED: message = 'Audio playback aborted.'; break;
                case MediaError.MEDIA_ERR_NETWORK: message = 'Audio download failed due to network error.'; break;
                case MediaError.MEDIA_ERR_DECODE: message = 'Audio playback failed due to decoding error (file might be corrupt).'; break;
                case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: message = 'Audio format not supported.'; break;
                default: message = `Audio error code: ${audioPlayer.error.code}`; break;
            }
        }
        showNotification(message, "danger");
        // Optional: Try to skip to the next song or stop
        const nextIndex = selectNextSong();
         if (nextIndex !== -1 && nextIndex !== currentSongIndex) { // Avoid infinite loop on bad file
            playSong(nextIndex);
         } else {
            stopMusic();
         }
    });


    function startTimer() {
        clearInterval(updateTimerInterval); // Clear any existing timer
        if (!isPlaying || isPaused) return; // Don't start if not playing

        updateTimerInterval = setInterval(() => {
            if (isPlaying && !isPaused && minutesBank > 0) {
                minutesBank -= (1 / 60); // Decrease by 1 second worth of minutes
                if (minutesBank < 0) minutesBank = 0; // Floor at 0
                updateMinutesDisplay();

                // Save progress periodically (e.g., every 10 seconds)
                // This reduces localStorage writes compared to every second
                if (Math.floor(audioPlayer.currentTime) % 10 === 0) {
                     saveMusicProgress();
                }

                if (minutesBank <= 0) {
                    showNotification('Music time is up!', "warning");
                    stopMusic(); // Stop playback cleanly
                }
            } else if (minutesBank <= 0) {
                 // Safety check in case state is weird
                 stopMusic();
            }
        }, 1000); // Run every second
    }

    // Save state when playback mode changes
    playbackModeSelect.addEventListener('change', saveMusicProgress);


    // --- Keyboard Shortcuts ---
    document.addEventListener('keydown', function(event) {
        // Don't trigger shortcuts if user is typing in an input/textarea
        const activeElement = document.activeElement;
        const isTyping = activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA';

        // Ctrl+S or Cmd+S: Save Entry (if form visible and not typing in content/title)
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
             event.preventDefault();
             // Trigger form submission directly
             entryForm.dispatchEvent(new Event('submit', { cancelable: true }));
        }

        // Ctrl+N or Cmd+N: New Entry (Clear form)
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
            if (!isTyping) { // Allow Ctrl+N in text fields for default behavior
                 event.preventDefault();
                 resetForm();
                 closeEntryDetail(); // Ensure detail view is closed
                 entryForm.style.display = 'block'; // Ensure form is visible
                 titleInput.focus();
            }
        }

        // Ctrl+E or Cmd+E: Edit Current Entry (if detail view is open)
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
            if (entryDetailsCard.style.display === 'block') {
                event.preventDefault();
                const id = entryDetailsCard.dataset.id;
                if (id) {
                    loadEntryForEdit(id);
                }
            }
        }

         // Esc: Close Detail View or Cancel Edit
         if (event.key === 'Escape') {
             if (entryDetailsCard.style.display === 'block') {
                 event.preventDefault();
                 closeEntryDetail();
             } else if (editingEntryIdInput.value) { // If in edit mode
                 event.preventDefault();
                 resetForm(); // Cancel the edit
             }
              hideNotification(); // Also hide notifications on Esc
         }
    });

    // --- Initialization ---
    async function initializeApp() {
        showNotification("Initializing...", "info");
        try {
            encryptionKey = await getKey();
            if (!encryptionKey && isLocalStorageAvailable()) {
                 // This case happens if key generation failed but LS is available
                 showNotification("Failed to get or generate encryption key. Cannot encrypt/decrypt.", "danger");
                 // Disable sensitive operations
                 saveEntryBtn.disabled = true;
                 // exportBtn.disabled = true; // Already handled by LS check? Re-check logic
            }

            await openDB();
            loadEntries();
            loadMusicProgress(); // Load saved music state
            showNotification("Application ready.", "success");
        } catch (error) {
            console.error("Initialization failed:", error);
            showNotification(`Initialization failed: ${error}. App may not function correctly.`, "danger");
        }
    }

    initializeApp(); // Start the application
}); // End DOMContentLoaded