// The "這次面試" box above the shortcuts. It starts as a box to paste the job
// description into. Once Claude has read it, it shows the company, the role,
// and the skills the role needs most, with a button to change it.
//
// Only buttons and a text box: no title attributes and no <select>, since
// tooltips and dropdown lists are separate windows that screen capture sees.
export function createJobBriefView({ element, submit }) {
    let status = { state: 'empty' };
    // True while changing a job description that was already read.
    let editing = false;
    let draft = '';

    function make(tag, className, text) {
        const node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text !== undefined) {
            node.textContent = text;
        }
        return node;
    }

    function makeButton(label, onClick) {
        const button = make('button', 'choice-chip', label);
        button.type = 'button';
        button.addEventListener('click', onClick);
        return button;
    }

    function describePosition() {
        const parts = [status.company, status.role].filter(Boolean);
        return parts.length > 0 ? parts.join(' · ') : 'JD 沒寫公司與職位';
    }

    function renderInput() {
        const input = make('textarea', 'settings-input job-brief-input');
        input.placeholder = '貼上職缺內容（JD），AI 會先讀過';
        input.spellcheck = false;
        input.value = draft;
        input.addEventListener('input', () => {
            draft = input.value;
        });
        element.appendChild(input);

        if (status.state === 'error' && status.message) {
            element.appendChild(make('div', 'job-brief-error', status.message));
        }

        const actions = make('div', 'job-brief-actions');
        if (editing) {
            actions.appendChild(makeButton('取消', () => {
                editing = false;
                render();
            }));
        }
        actions.appendChild(makeButton('讓 AI 讀', () => {
            draft = input.value;
            editing = false;
            submit(draft);
        }));
        element.appendChild(actions);
    }

    function renderBrief() {
        element.appendChild(make('div', 'job-brief-position', describePosition()));

        if (status.points?.length > 0) {
            const list = make('ul', 'job-brief-points');
            status.points.forEach((point) => list.appendChild(make('li', '', point)));
            element.appendChild(list);
        }

        const actions = make('div', 'job-brief-actions');
        actions.appendChild(makeButton('更換', () => {
            editing = true;
            draft = status.jobDescription || '';
            render();
        }));
        element.appendChild(actions);
    }

    function render() {
        element.textContent = '';
        element.appendChild(make('div', 'job-brief-title', '這次面試'));

        if (status.state === 'loading') {
            element.appendChild(make('div', 'job-brief-title', '正在讀 JD…'));
        } else if (status.state === 'ready' && !editing) {
            renderBrief();
        } else {
            renderInput();
        }
    }

    function update(nextStatus) {
        status = nextStatus && nextStatus.state ? nextStatus : { state: 'empty' };
        editing = false;
        // After a failure the pasted text stays in the box, ready to retry.
        draft = status.state === 'empty' ? '' : (status.jobDescription || draft);
        render();
    }

    render();

    return {
        update
    };
}
