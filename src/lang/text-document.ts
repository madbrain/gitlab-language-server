import { Position, PositionProvider } from './generic-model';

export class GenericTextDocument implements PositionProvider {
	lineOffsets: number[] = [];
	constructor(public text: string) {
		let current = 0;
		let atStart = true;
		while (current < text.length) {
			if (atStart) {
				this.lineOffsets.push(current);
			}
			// TODO handle CRLF
			atStart = text.charAt(current) == '\n';
			++current;
		}
		if (atStart) {
			this.lineOffsets.push(current);
		}
	}

	toPosition(offset: number): Position {
		let lineStart = 0;
		for (let line = 0; line < this.lineOffsets.length; ++line) {
			const end =
				line < this.lineOffsets.length - 1 ? this.lineOffsets[line + 1] - 1 : this.text.length;
			if (offset <= end) {
				return { line: line, column: offset - lineStart };
			}
			lineStart = this.lineOffsets[line + 1];
		}
		throw Error('impossible');
	}

	getLineBefore(position: Position) {
		const line = this.getLine(position.line);
		return line.slice(0, position.column);
	}

	getLine(line: number) {
		if (line >= this.lineOffsets.length) {
			return '';
		}
		const end = line < this.lineOffsets.length - 1 ? this.lineOffsets[line + 1] : this.text.length;
		return this.text.slice(this.lineOffsets[line], end);
	}

	debugDisplay() {
		let prev = -1;
		let index = 0;
		for (let lineStart of this.lineOffsets) {
			if (prev >= 0) {
				console.log(`${index++}|${this.text.slice(prev, lineStart - 1)}| ${lineStart - prev}`);
			}
			prev = lineStart;
		}
		console.log(`${index}|${this.text.slice(prev, this.text.length)}| ${this.text.length - prev}`);
	}
}
